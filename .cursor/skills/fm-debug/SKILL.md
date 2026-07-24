---
name: fm-debug
description: Debug a FileMaker script by capturing runtime state. The agent looks up the script source, generates a debug-instrumented copy, deploys it via the plugin, runs it, and reads $$DEBUG back through the Data Viewer endpoint. Triggers on phrases like "debug this", "script not working", "wrong output", "script error", or when a script produces unexpected behavior that cannot be diagnosed from source alone.
compatibility: Requires the agentic-fm plugin. Running scripts autonomously also requires AGFM_Bridge installed in the solution.
---

# fm-debug

Debug a FileMaker script by capturing runtime variable state, error codes, and error locations. Everything runs through the plugin — instrument, deploy, run, read back.

---

## Step 1: Confirm the plugin is reachable

```bash
python3 agent/scripts/agfm_bridge.py status
```

The plugin is the only path to FileMaker. If it is unreachable, say so and stop — do not fall back to stale data or manual workarounds.

---

## Step 2: Identify the diagnosis gap

Before generating any instrumentation:

1. **State specifically what runtime information is needed** — variable values, error codes, script result, which conditional branch was taken, etc.
2. **Check for existing debug output** at `agent/debug/output.json`. If it exists and is recent, read it and skip to Step 5.
3. **Look up the script source** — pull the script body from the plugin (`agfm_bridge.py discovery-query script_body --script "<Name>"`) to understand its logic and identify where to insert debug instrumentation.

---

## Step 3: Instrument the script

### Critical: error data capture pattern

`Get ( LastError )` resets the error state as a side effect. Once evaluated, `Get ( LastErrorLocation )` and `Get ( LastErrorDetail )` can no longer return data for that error. **All three must be captured in a single expression within one `Set Variable` step:**

```
Set Variable [ $errData ; JSONSetElement ( "{}" ;
    [ "lastError" ; Get ( LastError ) ; JSONNumber ] ;
    [ "lastErrorDetail" ; Get ( LastErrorDetail ) ; JSONString ] ;
    [ "lastErrorLocation" ; Get ( LastErrorLocation ) ; JSONString ]
) ]
```

When this pattern is used, `Get ( LastErrorLocation )` returns `"ScriptName\rStepName\rLineNumber"` (carriage-return separated).

**Never capture error data in separate steps** — the first `Set Variable` clears the error for subsequent ones. See `agent/docs/knowledge/error-data-capture.md` for full details.

Additionally, `Perform Script` resets `Get ( LastError )` to 0 when it successfully begins executing the subscript. The Agentic-fm Debug script's own error capture always sees `lastError = 0`. **Callers must capture error data in the calling script and pass it as part of the JSON parameter.**

### Building the instrumented script

Look up the target script's ID from the plugin (preferred) or index fallback:

```bash
curl -s -H "Authorization: Bearer $(grep AGFM_PLUGIN_TOKEN /workspaces/agentic-fm/.env.local | cut -d= -f2)" \
  $(grep AGFM_PLUGIN_URL /workspaces/agentic-fm/.env.local | cut -d= -f2)/api/context | python3 -c "
import sys, json; d=json.load(sys.stdin)
for n,i in d.get('scripts',{}).items(): print(f\"{i.get('id')}|{n}\")
" | grep -i "ScriptName"
# Fallback: agfm_bridge.py discovery-query scripts
```

Read the script body from the plugin to understand the logic. Identify where to insert debug capture points — typically immediately after steps that might fail or at decision points.

Generate a modified copy of the script as fmxmlsnippet XML in `agent/sandbox/` that includes debug instrumentation at the identified points. Each debug point should:

1. Capture error data in a single expression (the `$errData` pattern above)
2. Capture any relevant local variables
3. Call `Perform Script [ "Agentic-fm Debug" ]` with the captured state as a JSON parameter

Example debug instrumentation to insert after a risky step:

```
# Capture error data in ONE expression — Get(LastError) resets the error state
Set Variable [ $errData ; JSONSetElement ( "{}" ;
    [ "lastError" ; Get ( LastError ) ; JSONNumber ] ;
    [ "lastErrorDetail" ; Get ( LastErrorDetail ) ; JSONString ] ;
    [ "lastErrorLocation" ; Get ( LastErrorLocation ) ; JSONString ]
) ]
Perform Script [ "Agentic-fm Debug" ; Parameter: JSONSetElement ( "{}" ;
    [ "label" ; "after the risky step" ; JSONString ] ;
    [ "vars"  ; JSONSetElement ( "{}" ;
        [ "errData"  ; $errData  ; JSONRaw ] ;
        [ "myVar"    ; $myVar    ; JSONString ] ;
        [ "otherVar" ; $otherVar ; JSONString ]
    ) ; JSONRaw ]
) ]
```

Validate the instrumented script with `validate_snippet.py` before proceeding.

---

## Step 4: Deploy and run

### Autonomous (default)

The agent has the full deploy → run → read loop available:

**Pause first** — deploying and running touches the developer's live file. Ask before proceeding and wait for a go-ahead.

1. **Deploy the instrumented script**
   ```bash
   # Existing script — replace all steps
   python3 agent/scripts/agfm_bridge.py deploy agent/sandbox/{Solution}/{ScriptName}.fmscript "{ScriptName}"

   # New debug script
   python3 agent/scripts/agfm_bridge.py bundle agent/sandbox/{Solution}/{ScriptName}.fmscript --names "{ScriptName}"
   ```
2. **Run it** — `POST /api/performscript` with `{"scriptName": "{ScriptName}"}`, then poll `/api/eval/:id` until `complete: true`. **One at a time** — concurrent calls deadlock FileMaker.
3. **Read the output** — `GET /api/ui/dataviewer` and pull the `$$DEBUG` entry.

**Prerequisites for autonomous debugging:**
- The plugin must be reachable (`agfm_bridge.py status`)
- `AGFM_Bridge` must be installed in the solution (`agfm_bridge.py bridge-upgrade`)
- Agentic-fm Debug script must be installed in the solution

**Important**: when instrumenting an existing script, save its current body to `agent/sandbox/{Solution}/{ScriptName}.original.fmscript` first. After debugging, deploy that original back to restore it.

### Developer-assisted (scripts with side effects)

Give the developer clear instructions:

> To debug this, I need runtime variable state. Please do the following:
>
> 1. The instrumented script is on your clipboard. Open **"Script Name"** in Script Workspace
> 2. **Cmd+A** — select all existing steps and delete
> 3. **Cmd+V** — paste the instrumented version
> 4. Run the script as you normally would
> 5. Let me know when it's done — I'll read `agent/debug/output.json` directly.

After debugging, provide the original script back on the clipboard for the developer to restore.

---

## Step 5: Read and analyze the output

Read `agent/debug/output.json`:

```bash
cat agent/debug/output.json
```

The output contains:
- **`vars`** — the variables and error data captured by the instrumented script. **This is the authoritative diagnostic data.** The `errData` object within `vars` contains `lastError`, `lastErrorDetail`, and `lastErrorLocation` as captured by the calling script.
- **Top-level `lastError`/`lastErrorLocation`** — captured by the debug script itself. Always 0/empty because `Perform Script` resets the error state. Ignore these for diagnosis.
- **`timestamp`** — when the debug script ran
- **`label`** — description of the debug point

Parse the error data and identify the root cause. Explain the issue clearly and propose the fix.

---

## Fallback: $$DEBUG Global Variable

If the solution does not have an Agentic-fm Debug script, the developer can add a temporary `Set Variable` step to collect debug state into a `$$DEBUG` global:

```
Set Variable [ $$DEBUG ; JSONSetElement ( "{}" ;
    [ "errData" ; JSONSetElement ( "{}" ;
        [ "lastError" ; Get ( LastError ) ; JSONNumber ] ;
        [ "lastErrorDetail" ; Get ( LastErrorDetail ) ; JSONString ] ;
        [ "lastErrorLocation" ; Get ( LastErrorLocation ) ; JSONString ]
    ) ; JSONRaw ] ;
    [ "varName1" ; $varName1 ; JSONString ] ;
    [ "varName2" ; $varName2 ; JSONString ]
) ]
```

The developer retrieves the value from the Data Viewer (Tools > Data Viewer) and pastes it into the conversation.

---

## After diagnosis

1. Explain the root cause clearly
2. Propose and generate the fix
3. **Restore the original script** — if the script was modified for debugging, deploy the original version back via `agfm_bridge.py deploy`
4. If the Agentic-fm Debug script doesn't exist yet, offer to help create it (see `agent/docs/AGENTIC_DEBUG.md`)
