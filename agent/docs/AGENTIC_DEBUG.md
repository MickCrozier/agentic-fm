# Agentic-fm Debug Script

## Purpose

FileMaker script execution is opaque from the outside. The plugin closes that gap: the agent can run a script (`POST /api/performscript`) and read back the variables it left behind (`GET /api/ui/dataviewer`) without the developer copying anything by hand.

## How it works

1. The failing script (or a temporary instrumented copy of it) writes its runtime state into a `$$DEBUG` global variable
2. The agent runs the script via `POST /api/performscript` — or asks the developer to run it, if it has side effects
3. The agent reads `$$DEBUG` back via `GET /api/ui/dataviewer`
4. The agent analyzes the output and proposes a fix

> **One at a time.** Concurrent `/api/performscript` calls deadlock FileMaker. Run one, poll `/api/eval/:id` until `complete: true`, then run the next.
>
> **Pause first.** Running a script touches the developer's live file. Ask before triggering, and wait for a go-ahead.

## Critical: `Get ( LastError )` resets the error state

`Get ( LastError )` is not a passive read — **it clears the error state as a side effect.** Once evaluated, `Get ( LastErrorLocation )` and `Get ( LastErrorDetail )` can no longer return data for that error. All three functions must be captured in a **single expression** within one `Set Variable` step. See `agent/docs/knowledge/error-data-capture.md` for the full explanation and test evidence.

Additionally, `Perform Script` resets `Get ( LastError )` to 0 when it successfully begins executing the subscript. This means the debug script's own `$errorContext` capture (see below) always sees `lastError = 0`. **Callers must capture error data before calling `Perform Script` and pass it as part of the JSON parameter.**

## Script design

The **Agentic-fm Debug** script accepts a single parameter: a JSON object with any keys the calling script wants to expose. It appends that object — plus metadata (timestamp, calling script name) — to the `$$DEBUG` global, which the agent then reads through the Data Viewer endpoint.

**Script parameter format** (passed by the calling script):
```json
{
  "label": "optional description of where this debug point is",
  "vars": {
    "errData": { "lastError": 102, "lastErrorDetail": "", "lastErrorLocation": "MyScript\rSet Field\r6" },
    "exitCode": "1",
    "stderr": "",
    "stdout": "..."
  }
}
```

**Important**: The `errData` object above was captured by the **calling script** using the single-expression pattern (see Calling Convention below). It is the authoritative error data. The debug script's own `lastError`/`lastErrorLocation` fields in the output will always be 0/empty because `Perform Script` resets the error state.

**Agentic-fm Debug script steps (HR format):**
```
# PURPOSE: Append runtime debug state to $$DEBUG for agent inspection via
# GET /api/ui/dataviewer.
# Called by other scripts via Perform Script with a JSON parameter.
#
# $errorContext capture is a safety net for edge cases only (e.g., errors within
# the Perform Script step itself). Callers should NOT rely on it — Perform Script
# resets Get(LastError) to 0 before this script's first line runs. Error data
# must be captured by the caller and passed in the parameter's "vars" key.

# Capture caller's error state (safety net — usually 0 due to Perform Script reset)
Set Variable [ $errorContext ; JSONSetElement ( "{}" ;
    [ "lastError" ; Get ( LastError ) ; JSONNumber ] ;
    [ "lastErrorLocation" ; Get ( LastErrorLocation ) ; JSONString ]
) ]

Set Variable [ $param ; Get ( ScriptParameter ) ]

Set Variable [ $payload ; JSONSetElement ( "{}" ;
    [ "label" ; JSONGetElement ( $param ; "label" ) ; JSONString ] ;
    [ "vars" ; JSONGetElement ( $param ; "vars" ) ; JSONRaw ] ;
    [ "timestamp" ; Get ( CurrentTimestamp ) ; JSONString ] ;
    [ "lastError" ; JSONGetElement ( $errorContext ; "lastError" ) ; JSONNumber ] ;
    [ "lastErrorLocation" ; JSONGetElement ( $errorContext ; "lastErrorLocation" ) ; JSONString ]
) ]

# Append this entry to the $$DEBUG array — the agent reads it via /api/ui/dataviewer
Set Variable [ $$DEBUG ; JSONSetElement (
    If ( JSONGetElementType ( $$DEBUG ; "" ) = JSONArray ; $$DEBUG ; "[]" ) ;
    [ "[+]" ; $payload ; JSONRaw ]
) ]
```

Reset it between runs with `Set Variable [ $$DEBUG ; "[]" ]` at the top of the script under test, so stale entries don't confuse the diagnosis.

## Calling convention: how to instrument a script

Error data must be captured **in the calling script** before `Perform Script`. Use this pattern:

```
# After the step that might fail:
# Capture ALL error data in ONE expression — Get(LastError) resets the error state
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

### Interpreting the output

Each `$$DEBUG` entry contains two sources of error data:
- **`vars.errData`** — captured by the calling script. **This is the authoritative error data.** Use this for diagnosis.
- **Top-level `lastError`/`lastErrorLocation`** — captured by the debug script itself. Always 0/empty because `Perform Script` resets the error state. Kept as a safety net for edge cases.

## Get ( LastErrorLocation ) and line numbers

`Get ( LastErrorLocation )` (added in FM 19.6.1) returns the script name, step name, and line number of the last error in the format `"ScriptName\rStepName\rLineNumber"` (carriage-return separated — `\r` / `&#xD;` / `Char(13)`).

**It works correctly** but only when captured in the same expression as `Get ( LastError )`. If captured in a separate step after `Get ( LastError )`, it returns empty because the error state has already been cleared.

**When a real error occurred:** capture `$errData` immediately after the failing step using the single-expression pattern above.

**When no error occurred but you need the current line number:** Force a harmless error, then capture immediately in one expression:

```
Set Error Capture [ On ]
Set Field []   # error 102 — no field specified
# Capture ALL error data in ONE expression immediately
Set Variable [ $errData ; JSONSetElement ( "{}" ;
    [ "lastError" ; Get ( LastError ) ; JSONNumber ] ;
    [ "lastErrorDetail" ; Get ( LastErrorDetail ) ; JSONString ] ;
    [ "lastErrorLocation" ; Get ( LastErrorLocation ) ; JSONString ]
) ]
Perform Script [ "Agentic-fm Debug" ; Parameter: JSONSetElement ( "{}" ;
    [ "label" ; "forced error for line number" ; JSONString ] ;
    [ "vars"  ; JSONSetElement ( "{}" ;
        [ "errData" ; $errData ; JSONRaw ]
    ) ; JSONRaw ]
) ]
Set Error Capture [ Off ]
```

The `$errData.lastErrorLocation` will contain the line number of the `Set Field []` step.

## Reading the output

```bash
TOKEN=$AGFM_PLUGIN_TOKEN
PORT=${AGFM_PLUGIN_PORT:-8766}
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:${PORT}/api/ui/dataviewer"
```

The response lists the Data Viewer's current variables and Watch expressions. Pull the `$$DEBUG` entry and parse its JSON.

If `$$DEBUG` is not visible, add it as a Watch expression in **Tools > Data Viewer > Watch**, or evaluate it directly:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"calculation": "$$DEBUG"}' "http://localhost:${PORT}/api/eval"
# then poll /api/eval/:id until complete: true
```

## Using $$DEBUG without the helper script

For a one-off diagnostic, skip **Agentic-fm Debug** entirely and set the global inline:

```filemaker
Set Variable [ $$DEBUG ; JSONSetElement ( "{}" ;
    [ "exitCode" ; $exitCode ; JSONString ] ;
    [ "stderr"   ; $stderr   ; JSONString ] ;
    [ "stdout"   ; $stdout   ; JSONString ]
) ]
```

Read it back the same way. This gives you a single snapshot rather than an appended trail.

## Agent workflow

When the agent needs runtime debug information:

1. The agent uses the `fm-debug` skill (`.claude/skills/fm-debug/SKILL.md`)
2. It deploys an instrumented copy of the script via `agfm_bridge.py` — after pausing for the developer's go-ahead
3. It runs the script via `POST /api/performscript`, or asks the developer to run it if the script has side effects
4. It reads `$$DEBUG` back via `GET /api/ui/dataviewer`
5. It analyzes the output and proposes a fix

Everything here requires the plugin. If it is unreachable, the agent can still write the instrumented script — it just cannot deploy, run, or read results until the plugin is back.
