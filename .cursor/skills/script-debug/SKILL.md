---
name: script-debug
description: Systematic debugging workflow for FileMaker scripts — reproduce the issue, isolate the failure point, form a hypothesis, verify with runtime data, and produce a fix. The agent instruments the script, deploys the instrumented version through the plugin, runs it, reads $$DEBUG back, and iterates until the root cause is found. Triggers on phrases like "debug this", "script not working", "wrong output", "script error", or when a script produces unexpected behavior.
---

# Script Debug

A systematic debugging workflow: reproduce → isolate → hypothesise → verify → fix. This skill orchestrates the full diagnostic cycle, using `fm-debug` for runtime data capture.

---

## Step 1: Confirm the plugin is reachable

```bash
python3 agent/scripts/agfm_bridge.py status
```

The plugin is the only path to FileMaker. If it is unreachable, say so and stop — do not fall back to stale data or manual workarounds.

---

## Step 2: Understand the problem

Gather information from the developer:

1. **What script?** — name or ID
2. **What happens?** — error dialog, wrong output, unexpected behaviour, hang
3. **What should happen?** — expected result
4. **When does it happen?** — always, only with certain data, only on server, etc.
5. **Any recent changes?** — was the script modified recently?

Pull the script body from the plugin: `agfm_bridge.py discovery-query script_body --script "<Name>"`.

### Resolve the call tree

Before forming hypotheses, load the full call tree — the bug may be in a subscript.

1. **Extract Perform Script references** — scan the human-readable script for all `Perform Script` lines. Extract every target script name.
2. **Load each subscript** — pull each subscript's body from the plugin. Resolve name→ID via plugin (preferred):
   ```bash
   curl -s -H "Authorization: Bearer $(grep AGFM_PLUGIN_TOKEN /workspaces/agentic-fm/.env.local | cut -d= -f2)" \
     $(grep AGFM_PLUGIN_URL /workspaces/agentic-fm/.env.local | cut -d= -f2)/api/context | python3 -c "
   import sys, json; d=json.load(sys.stdin)
   for n,i in d.get('scripts',{}).items(): print(f\"{i.get('id')}|{n}\")
   " | grep -i "ScriptName"
   ```
   Fallback: `agfm_bridge.py discovery-query scripts`
3. **Recurse** — each subscript may call further subscripts. Repeat until no new references are found. Track visited scripts to avoid cycles.
4. **Present the call tree**:

```
Call tree: [Script Name]
├── Subscript A
│   └── Subscript A1
├── Subscript B
└── Subscript C
```

Flag any `Perform Script by name` (calculated names) that cannot be statically resolved — ask the developer which scripts may be called at that point.

Understanding the full call tree is critical for debugging because:
- An error in a subscript may surface as unexpected behaviour in the caller
- A subscript may silently change layout context, found set, or global variables
- Parameter/result contract mismatches between caller and callee are a common bug category

---

## Step 3: Form initial hypotheses

Based on the source code and the developer's description, identify the most likely failure points. Common categories:

| Category | Symptoms | What to check |
|---|---|---|
| **Error not handled** | Works sometimes, fails silently | Missing `Get ( LastError )` check after a risky step |
| **Wrong layout context** | Field shows `?`, wrong data | Script assumes a layout but doesn't navigate to it |
| **Empty found set** | Unexpected behaviour after find | No error 401 handling after `Perform Find` |
| **Stale variable** | Wrong value used | Global variable (`$$`) from a previous run, or variable set in wrong branch |
| **Parameter mismatch** | Subscript fails or returns wrong result | Caller sends wrong format, callee expects different structure |
| **Record locking** | Intermittent failures | Error 301 not handled, multi-user contention |
| **Server vs client** | Works in Pro, fails on server | UI step on server, missing `Set Error Capture`, layout context issue |

Rank hypotheses by likelihood and identify which runtime data would confirm or eliminate each one.

---

## Step 4: Instrument the script

Generate a debug-instrumented copy of the script. Insert capture points at the identified locations using the `fm-debug` pattern.

### What to capture at each debug point

Each debug point is a pair of steps: the single-expression error capture, then a `Perform Script` call to Agentic-fm Debug.

```
# DEBUG POINT: [description of what we're checking]
Set Variable [ $errData ; JSONSetElement ( "{}" ;
    [ "lastError" ; Get ( LastError ) ; JSONNumber ] ;
    [ "lastErrorDetail" ; Get ( LastErrorDetail ) ; JSONString ] ;
    [ "lastErrorLocation" ; Get ( LastErrorLocation ) ; JSONString ]
) ]
Perform Script [ "Agentic-fm Debug" ; Parameter: JSONSetElement ( "{}" ;
    [ "label" ; "[description]" ; JSONString ] ;
    [ "vars"  ; JSONSetElement ( "{}" ;
        [ "errData"    ; $errData    ; JSONRaw ] ;
        [ "relevantVar" ; $relevantVar ; JSONString ]
    ) ; JSONRaw ]
) ]
```

**Placement strategy** — insert debug points:
- After each step identified as a likely failure point
- Before and after conditional branches to trace which path was taken
- Before `Exit Script` to capture the final state
- After `Perform Script` calls to check `Get ( ScriptResult )`

**Important**: the error capture `Set Variable` must be the **very next step** after the risky step. Do not insert a comment step or any other step between them — it would clear the error state.

Look up the Agentic-fm Debug script ID from the plugin (preferred) or index fallback:

```bash
curl -s -H "Authorization: Bearer $(grep AGFM_PLUGIN_TOKEN /workspaces/agentic-fm/.env.local | cut -d= -f2)" \
  $(grep AGFM_PLUGIN_URL /workspaces/agentic-fm/.env.local | cut -d= -f2)/api/context | python3 -c "
import sys, json; d=json.load(sys.stdin)
for n,i in d.get('scripts',{}).items(): print(f\"{i.get('id')}|{n}\")
" | grep -i "Agentic-fm Debug"
# Fallback: agfm_bridge.py discovery-query scripts
```

Generate the instrumented script as fmxmlsnippet in `agent/sandbox/` and validate:

```bash
python3 agent/scripts/validate_snippet.py agent/sandbox/{ScriptName}.xml
```

---

## Step 5: Deploy and run

### Autonomous (default)

1. **Save the original** — write the current script body to `agent/sandbox/{Solution}/{ScriptName}.original.fmscript` before replacing it
2. **Deploy the instrumented version** — after pausing for the developer's go-ahead:
   ```bash
   python3 agent/scripts/agfm_bridge.py deploy agent/sandbox/{Solution}/{ScriptName}.fmscript "{ScriptName}"
   ```
3. **Run the script** — `POST /api/performscript` with `{"scriptName": "{ScriptName}"}`, then poll `/api/eval/:id` until `complete: true`
4. **Read the output** — `GET /api/ui/dataviewer` and pull the `$$DEBUG` entry
5. **Iterate if needed** — if the first debug output doesn't reveal the root cause, adjust instrumentation and repeat from step 4

### Developer-assisted (scripts with side effects)

1. Present the instrumented script on the clipboard with paste instructions:

   > The instrumented script is on your clipboard. To install it:
   >
   > 1. Open **Script Name** in Script Workspace
   > 2. **Cmd+A** — select all existing steps and delete
   > 3. **Cmd+V** — paste the debug version
   > 4. Run the script with the same inputs that trigger the bug
   > 5. Let me know when it's done — I'll read `agent/debug/output.json` directly.

2. After the developer confirms, read `agent/debug/output.json`

---

## Step 6: Analyse debug output

Read `agent/debug/output.json` and interpret the results:

- **`vars.errData.lastError`** — the error code captured at the debug point (0 = no error)
- **`vars.errData.lastErrorLocation`** — `"ScriptName\rStepName\rLineNumber"` if an error occurred
- **Other vars** — variable values at the debug point

Cross-reference with the human-readable script to map line numbers to steps.

### Common patterns in debug output

| Finding | Likely cause | Next step |
|---|---|---|
| `lastError: 401` after Perform Find | No records match | Check find criteria, field values |
| `lastError: 301` after Set Field | Record locked | Add record locking handling |
| `lastError: 0` but wrong variable value | Logic error, not an FM error | Trace the calculation |
| Variable is empty when expected full | Set in a conditional branch that wasn't taken | Check If/Else logic |
| `Get ( ScriptResult )` empty after Perform Script | Subscript didn't Exit Script with a result | Check the subscript |

---

## Step 7: Produce the fix

Once the root cause is identified:

1. **Explain the root cause** clearly to the developer — what went wrong, why, and at what line
2. **Generate the fixed script** as fmxmlsnippet in `agent/sandbox/` — remove all debug instrumentation and apply the fix
3. **Validate**: `python3 agent/scripts/validate_snippet.py agent/sandbox/{ScriptName}.xml`
4. **Deploy** the fix with `agfm_bridge.py deploy`, replacing the instrumented version — after pausing for the developer's go-ahead

### Restore safety

If the fix doesn't work or the developer wants to revert, redeploy the pre-instrumentation copy you saved into `agent/sandbox/{Solution}/`. Always save that copy before instrumenting:

```bash
python3 agent/scripts/fm_xml_to_snippet.py "<saxml-export-dir>/scripts/{path}.xml" "agent/sandbox/{Solution}/{ScriptName}.xml"
```

---

## Constraints

- **Keep the pre-instrumentation copy** in `agent/sandbox/{Solution}/` so you can always revert
- **Always restore the original script** after debugging unless the developer explicitly approves the fix as the new version
- **One script at a time** — if the bug is in a subscript, debug that subscript separately
- **Label every debug point** — use descriptive labels in the `Perform Script` parameter so the output is self-documenting
