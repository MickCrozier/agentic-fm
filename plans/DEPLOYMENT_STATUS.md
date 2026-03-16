# Deployment Module — Build Status

Session-persistent notes on what was built, every quirk discovered, and where to resume. Read this at the start of any session continuing deployment work.

---

## What was built

### `agent/scripts/deploy.py`
CLI + importable module. Reads `agent/config/automation.json`. Three tiers:
- **Tier 1**: POSTs XML to companion `/clipboard`, returns paste instructions
- **Tier 2**: `/clipboard` + `/trigger` → Agentic-fm Paste auto-pastes via MBS
- **Tier 3**: `/trigger` (AGFMNewScript placeholder) → Tier 2 — **not yet implemented**

CLI usage:
```bash
python3 agent/scripts/deploy.py <xml_path> [target_script] [--tier N] [--auto-save] [--no-auto-save]
```

### `agent/config/automation.json`
Key fields: `default_tier`, `project_tier`, `auto_save`, `fm_app_name`, `companion_url`.
- `default_tier: 1` — safe default for new developers
- `project_tier: 3` — target for this project (once Tier 3 proven)
- `auto_save: false` — override per deploy with `--auto-save`
- `fm_app_name` must match the exact AppleScript application name including em dash and version: `"FileMaker Pro — 22.0.4.406"`

### `agent/sandbox/Agentic-fm Paste.xml`
MBS-powered FM script. Installed in the solution. Called by companion `/trigger` via AppleScript `do script`. Flow:
1. `GET localhost:8765/pending` → retrieves `target` (script name) + `auto_save` flag
2. `Open Script Workspace` step
3. `MBS("ScriptWorkspace.OpenScript"; $target)`
4. 0.5s busy-wait loop (no Pause/Resume — it steals focus)
5. `MBS("Menubar.RunMenuCommand"; 57636)` — Select All
6. `MBS("Menubar.RunMenuCommand"; 57637)` — Paste
7. If `$autoSave`: `Perform AppleScript [ tell application "System Events" to keystroke "s" using {command down} ]`

### Companion server additions (`agent/scripts/companion_server.py`)
New endpoints:
- `GET /pending` — returns and clears `{target, auto_save}` job set by last `/trigger` call
- `POST /pending` — sets the pending job directly (for testing)
- `POST /clipboard` — writes XML to macOS clipboard via `clipboard.py`
- `POST /trigger` — fires `osascript` to `do script` in FM Pro; sets pending job before firing

---

## Critical quirks discovered (do not re-learn these)

### AppleScript parameter passing is broken in FM Pro 22
`do script "ScriptName" given parameter:"value"` compiles without error but `Get(ScriptParameter)` returns empty inside the triggered script. `with parameter "string"` gives a syntax error. **Workaround**: companion server stores the target in `/pending` before firing `do script`. FM script GETs `/pending` via Insert from URL.

### `Pause/Resume Script` steals focus
Using `Pause/Resume Script [Duration: 0.5]` between `ScriptWorkspace.OpenScript` and the MBS menubar commands causes a system beep — the pause yields UI focus away from Script Workspace. **Use a busy-wait loop instead**:
```
Set Variable [ $waitUntil ; Get(CurrentHostTimestamp) + .5 / 86400 ]
Loop
  Exit Loop If [ Get(CurrentHostTimestamp) ≥ $waitUntil ]
End Loop
```

### `menu bar` and `menu bar 1` both fail in Perform AppleScript
`tell me to do menu item "Save All Scripts" of menu "Scripts" of menu bar` → "variable bar not found"
`tell me to do menu item "Save All Scripts" of menu "Scripts" of menu bar 1` → "A number can't go after this identifier"
FileMaker's built-in AppleScript parser rejects both. **Use System Events keystroke instead**:
`tell application "System Events" to keystroke "s" using {command down}`
Requires FM Pro to have Accessibility access in System Preferences → Privacy & Security → Accessibility.

### `MBS("ScriptWorkspace.SaveScript")` does not exist
Not a real MBS function. Use the System Events keystroke approach above.

### AppleScript `activate` is required
Without `activate` in the AppleScript template, FM Pro stays in the background. MBS commands execute against whatever window is frontmost (not FM). Added to all `/trigger` AppleScript templates.

### FM blocks script execution with unsaved-scripts dialog
FileMaker will show a dialog and block `do script` if any scripts have unsaved changes in the Script Workspace. Agentic-fm Paste itself must be saved before running deployments. The `--auto-save` flag calls "Save All Scripts" at the end to clean up for subsequent runs.

### `fmextscriptaccess` required
The extended privilege "Allow Apple events and ActiveX to perform FileMaker operations" must be enabled on the account's privilege set in Manage Security. Without it, `do script` returns `-10004` at runtime. No compile error.

### Script Workspace must be open before paste (cold-start timing)
When Script Workspace is closed, `Open Script Workspace` + `ScriptWorkspace.OpenScript` triggers it to open and navigate. The 0.5s busy-wait is essential here — without it, the MBS paste commands fire before the workspace has finished rendering and either beep or paste into the wrong location.

### MBS menubar command IDs for Script Workspace
- `57636` = Select All (Edit menu in Script Workspace context)
- `57637` = Paste (Edit menu in Script Workspace context)
These were verified working. Do not change without testing.

---

## Current status

| Feature | Status |
|---|---|
| Tier 1 (clipboard + manual paste) | ✅ Working |
| Tier 2 (auto-paste into existing script) | ✅ Working |
| Tier 2 auto-save (`--auto-save`) | ✅ Working |
| `/pending` endpoint | ✅ Working |
| Tier 3 (AGFMNewScript placeholder creation) | ⬜ Not yet built |

---

## What to do next

### Tier 3 — AGFMNewScript
This FM script is called by `deploy.py` Tier 3 before the Tier 2 paste. It creates a blank placeholder script in FM Pro by name so the agent doesn't need a pre-existing script target. Likely implemented via MBS `ScriptWorkspace` functions or UI scripting. The pending mechanism already supports it — `deploy.py _tier3()` POSTs to `/trigger` with `script: "AGFMNewScript"` and `parameter: target_script`.

### Run Explode XML
Once Agentic-fm Paste is confirmed stable, run `Explode XML` in FM Pro to export the solution and get Agentic-fm Paste (and any other agentic-fm scripts) into `xml_parsed/`. This is the canonical record of what's installed in the solution.

### Set `auto_save: true` in automation.json for project use
When confident in the deployment loop, flip `auto_save` to `true` in `automation.json` to remove the `--auto-save` flag requirement.

---

## Key files

| File | Purpose |
|---|---|
| `agent/scripts/deploy.py` | Deployment module — CLI + importable |
| `agent/scripts/companion_server.py` | HTTP companion server on host |
| `agent/config/automation.json` | Tier config, fm_app_name, companion_url, auto_save |
| `agent/sandbox/Agentic-fm Paste.xml` | FM script — MBS auto-paste (install in solution) |
| `agent/docs/COMPANION_SERVER.md` | Full endpoint reference |
| `plans/SKILL_INTERFACES.md` | Deployment module contract for skills |
