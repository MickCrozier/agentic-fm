# Deployment Tier Testing Guide

How to verify each deployment tier is working correctly. Work through this in order — each tier builds on the previous one.

---

## Prerequisites

Complete every item before testing any tier. Missing prerequisites produce confusing failures.

### Host machine
- [ ] **Companion server running** on the host (not in a container), bound to `0.0.0.0`:
  ```bash
  COMPANION_BIND_HOST=0.0.0.0 python3 agent/scripts/companion_server.py
  ```
  Confirm it responds: `curl http://localhost:8765/health` → `{"status":"ok",...}`

- [ ] **`agent/config/automation.json` exists** with the correct `fm_app_name`. The name must match the exact AppleScript application name including em dash and version number. Find yours with:
  ```bash
  osascript -e 'tell application "System Events" to get name of every process whose name contains "FileMaker"'
  ```
  Example: `"FileMaker Pro — 22.0.4.406"`

### FileMaker Pro (Tier 2+ only)
- [ ] **MBS Plugin installed and licensed** (full suite required for ScriptWorkspace and Menubar functions)
- [ ] **Agentic-fm Paste script installed in your solution** — paste `agent/sandbox/Agentic-fm Paste.xml` into a script named exactly `Agentic-fm Paste`, save it
- [ ] **`fmextscriptaccess` enabled** — in FM Pro: File > Manage > Security → edit the Full Access privilege set → Extended Privileges → enable "Allow Apple events and ActiveX to perform FileMaker operations" (`fmextscriptaccess`)
- [ ] **Accessibility permission granted to FileMaker Pro** (required for auto-save only) — System Preferences → Privacy & Security → Accessibility → add FileMaker Pro

### Agent container (if running in Docker)
- [ ] Container can reach companion: `curl http://local.hub:8765/health` → `{"status":"ok",...}`
- [ ] `automation.json` has `"companion_url": "http://local.hub:8765"`

---

## Tier 1 — Clipboard + manual paste

**What it does:** Writes the XML to the macOS clipboard. You paste manually into Script Workspace.

### Test
```bash
python3 agent/scripts/deploy.py agent/sandbox/AGFMRoundTripTest.xml --tier 1
```

**Expected output:**
```
Script loaded to clipboard.
  Paste (⌘V) into the target script in Script Workspace.
```

**Verify:**
1. Open Script Workspace in FM Pro
2. Open any script
3. Select All (⌘A), Paste (⌘V)
4. The steps from `AGFMRoundTripTest.xml` should appear

**Common failures:**

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot connect to companion` | Server not running or wrong URL | Start companion, check `companion_url` in `automation.json` |
| Paste produces garbage characters | Used `pbcopy`/`pbpaste` instead of companion | Always use companion `/clipboard` endpoint |
| Nothing on clipboard | `clipboard.py` not on host path | Companion must run on the host, not in container |

---

## Tier 2 — MBS auto-paste

**What it does:** Writes XML to clipboard, triggers FM Pro via AppleScript to run `Agentic-fm Paste`, which opens Script Workspace, navigates to the target script, and pastes.

### Pre-test checklist
- [ ] Agentic-fm Paste is installed and **saved** in the solution (no `*` on its tab)
- [ ] The target script exists in the solution (Tier 2 pastes into an existing script — it does not create new ones)
- [ ] Script Workspace can be open or closed — both should work

### Test (review mode — no auto-save)
```bash
python3 agent/scripts/deploy.py agent/sandbox/AGFMRoundTripTest.xml AGFMRoundTripTest --tier 2
```

**Expected sequence:**
1. FM Pro comes to the foreground
2. Script Workspace opens (if not already open)
3. `AGFMRoundTripTest` script becomes active in the workspace
4. Brief pause (~0.5s)
5. Steps are pasted, replacing previous content
6. Script tab shows `*` indicating unsaved changes — **this is correct for review mode**

**Expected CLI output:**
```
Script pasted into 'AGFMRoundTripTest' via MBS.
```

### Test (auto-save mode)
```bash
python3 agent/scripts/deploy.py agent/sandbox/AGFMRoundTripTest.xml AGFMRoundTripTest --tier 2 --auto-save
```

**Expected sequence:** same as above, but script is saved automatically — `*` disappears from the tab.

### Common failures

| Symptom | Cause | Fix |
|---|---|---|
| FM Pro doesn't come to foreground | `activate` missing from AppleScript | Check companion server version — must include `activate` before `tell document 1` |
| Script Workspace opens but paste doesn't happen / system beep | `Pause/Resume Script` stealing focus | Agentic-fm Paste must use busy-wait loop, not `Pause/Resume Script` |
| Script Workspace opens but wrong script shown | `ScriptWorkspace.OpenScript` failed | Check `$openResult` — add debug step or check MBS version |
| `do script` gives `-10004` | `fmextscriptaccess` not enabled | Enable it in Manage Security → Full Access privilege set |
| `deploy.py` reports success but nothing happened | Stale result from Tier 1 clipboard load | Clear the target script, redeploy, watch FM Pro screen directly |
| Auto-save beeps or fails | Accessibility permission not granted | System Preferences → Privacy & Security → Accessibility → add FileMaker Pro |
| `Agentic-fm Paste` shows unsaved-scripts dialog when triggered | Agentic-fm Paste itself has unsaved changes | Save Agentic-fm Paste first before running any deployment |
| `/pending` returns empty target | Agentic-fm Paste ran before companion stored the target | Restart companion — the pending job is stored in memory; a server restart clears it |

### How the parameter gets passed (important to understand)
FM Pro 22 does not reliably receive parameters passed via `do script ... given parameter:`. The companion server uses a side channel: it stores `{target, auto_save}` in memory via `/pending` before firing the AppleScript, and Agentic-fm Paste calls `GET localhost:8765/pending` via Insert from URL to retrieve it. If the companion server is restarted between `/trigger` and Agentic-fm Paste running, the pending job is lost.

---

## Tier 2 — Step-by-step debug procedure

If Tier 2 is failing and you can't tell where, follow these steps in order.

### Step 1: Verify companion is reachable from FM Pro
In FM Pro, run this calculation in the Data Viewer:
```
Let ( [
    ~result = GetAsText ( Insert from URL ( "http://localhost:8765/health" ) )
] ; ~result )
```
Expected: `{"status":"ok",...}`

### Step 2: Verify `/pending` works
From the terminal:
```bash
curl -X POST http://localhost:8765/pending \
  -H "Content-Type: application/json" \
  -d '{"target":"TestScript","auto_save":false}'

curl http://localhost:8765/pending
# Expected: {"target":"TestScript","auto_save":false}

curl http://localhost:8765/pending
# Expected: {"target":"","auto_save":false}  ← cleared on first read
```

### Step 3: Verify Agentic-fm Paste can be triggered
From the terminal:
```bash
curl -X POST http://localhost:8765/trigger \
  -H "Content-Type: application/json" \
  -d '{"fm_app_name":"FileMaker Pro — 22.0.4.406","script":"Agentic-fm Paste","parameter":"AGFMRoundTripTest"}'
```
Expected: `{"success":true,"stdout":"","stderr":""}`

If `"success":false` with `-10004` in stderr → `fmextscriptaccess` not enabled.
If `"success":false` with `-600` → no document open in FM Pro.
If `"success":true` but nothing happens → watch FM Pro — it should come to foreground.

### Step 4: Add debug output to Agentic-fm Paste
If the script triggers but paste doesn't happen, add `Insert from URL` checkpoints to POST state to `localhost:8765/debug` and read `agent/debug/output.json`. See `agent/docs/AGENTIC_DEBUG.md`.

---

## Tier 3 — NOT YET IMPLEMENTED

Tier 3 adds `AGFMNewScript` — an FM script that creates a blank placeholder by name before the Tier 2 paste. This is needed when the target script doesn't exist yet. It is the project's target tier for production use.

Status: `deploy.py` calls `_tier3()` which posts to `/trigger` with `script: "AGFMNewScript"`, but `AGFMNewScript` has not been built yet. `deploy.py` falls back to Tier 2 on failure.

---

## Configuration reference

`agent/config/automation.json`:

```json
{
  "default_tier": 1,
  "project_tier": 3,
  "auto_save": false,
  "fm_app_name": "FileMaker Pro — 22.0.4.406",
  "companion_url": "http://local.hub:8765",
  "tiers": {
    "1": { "description": "Clipboard only", "requires": [] },
    "2": { "description": "MBS auto-paste", "requires": ["mbs_plugin"] },
    "3": { "description": "Full autonomy", "requires": ["mbs_plugin", "accessibility_permission"] }
  }
}
```

To enable auto-save globally (project use): set `"auto_save": true`.

CLI overrides:
```bash
--tier 2          # override tier for this deploy
--auto-save       # force auto-save on
--no-auto-save    # force auto-save off
```
