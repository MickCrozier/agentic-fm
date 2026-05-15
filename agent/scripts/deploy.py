#!/usr/bin/env python3
"""
deploy.py - Pluggable deployment module for agentic-fm.

Loads a validated fmxmlsnippet XML file to the FileMaker clipboard and
optionally triggers an automated paste into the Script Workspace.

Tier 1 (universal):  plugin /api/clipboard/write → developer pastes manually
Tier 2 (MBS):        plugin clipboard + /trigger → Agentic-fm Paste auto-pastes
Tier 3 (MBS + AS):   /trigger creates placeholder → then Tier 2
Tier 4 (plugin):     plugin navigate + insert + save — no AppleScript required

Usage (CLI):
    python3 agent/scripts/deploy.py <xml_path> [target_script] [--tier N]

Usage (module):
    from deploy import deploy
    result = deploy("agent/sandbox/MyScript.xml", target_script="My Script")

Result dict keys:
    success       — bool
    tier_used     — int (1–4; may differ from requested if fallback)
    instructions  — str (Tier 1 and fallback cases — present to developer)
    message       — str (Tier 2/3/4 success — for logging)
    fallback_from — int (present when fell back from a higher tier)
    fallback_reason — str (why the fallback occurred)
    error         — str (present on failure)
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_CONFIG = {
    "default_tier": 1,
    "auto_save": False,
    "fm_app_name": "FileMaker Pro",
    "companion_url": "http://local.hub:8767",
    "plugin_url": None,
    "plugin_token": None,
}

ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env.local")


def _load_plugin_auth() -> tuple[str | None, str | None]:
    """Load plugin URL and bearer token from root .env.local."""
    env: dict[str, str] = {}
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                env[key.strip()] = val.strip()
    except OSError:
        pass
    return env.get("AGFM_PLUGIN_URL"), env.get("AGFM_PLUGIN_TOKEN")


def _load_config() -> dict:
    here = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(here, "..", "config", "automation.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            merged = {**DEFAULT_CONFIG, **cfg}
    except (OSError, ValueError):
        merged = DEFAULT_CONFIG.copy()

    # Overlay plugin auth from agent/auth/plugin.json (gitignored secrets file)
    plugin_url, plugin_token = _load_plugin_auth()
    if plugin_url and not merged.get("plugin_url"):
        merged["plugin_url"] = plugin_url
    if plugin_token and not merged.get("plugin_token"):
        merged["plugin_token"] = plugin_token

    return merged


def _resolve_target_file(config: dict) -> str | None:
    """Auto-resolve the FM file name to target for multi-file deploys.

    Priority:
      1. CONTEXT.json → 'solution' field (scoped to what the developer is working on)
      2. automation.json → 'solutions' keys (only if exactly 1 solution configured)

    Returns None if the file cannot be unambiguously determined.
    """
    # Try CONTEXT.json first
    here = os.path.dirname(os.path.abspath(__file__))
    context_path = os.path.join(here, "..", "CONTEXT.json")
    try:
        with open(context_path, "r", encoding="utf-8") as f:
            ctx = json.load(f)
        solution = ctx.get("solution", "")
        if solution:
            return solution
    except (OSError, ValueError):
        pass

    # Fall back to automation.json solutions keys
    solutions = config.get("solutions", {})
    if len(solutions) == 1:
        return next(iter(solutions))

    return None


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _post_json(url: str, payload: dict, timeout: int = 15, token: str | None = None) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except ValueError:
            return {"success": False, "error": f"HTTP {exc.code}: {raw}"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def _get_json(url: str, timeout: int = 15, token: str | None = None) -> dict:
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except ValueError:
            return {"success": False, "error": f"HTTP {exc.code}: {raw}"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Window switching helper
# ---------------------------------------------------------------------------

def _switch_to_document(
    companion_url: str,
    fm_app_name: str,
    target_file: str,
) -> dict:
    """Bring the target file's window to front via System Events.

    FM gates AppleScript do-script privilege checks on the frontmost
    document. If the wrong file is frontmost and lacks fmextscriptaccess,
    do-script fails with -10004 even when targeting the correct document.
    This helper switches the frontmost window before any do-script call.

    Uses the Tools > Custom Menus > [Standard FileMaker Menus] guard to
    ensure the Window menu is available, then clicks the target file's
    entry in the Window menu.
    """
    def _esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')

    fm_process = fm_app_name.split(" \u2014 ")[0].strip()

    applescript = (
        f'tell application "{_esc(fm_app_name)}"\n'
        f'    activate\n'
        f'end tell\n'
        f'\n'
        f'delay 0.3\n'
        f'\n'
        f'tell application "System Events"\n'
        f'    tell process "{_esc(fm_process)}"\n'
        # Switch to standard menus so the Window menu is available
        f'        try\n'
        f'            click menu item "[Standard FileMaker Menus]" of menu "Custom Menus" of menu item "Custom Menus" of menu "Tools" of menu bar 1\n'
        f'            delay 0.3\n'
        f'        end try\n'
        # Click the target file in the Window menu
        f'        try\n'
        f'            set _menuItems to every menu item of menu "Window" of menu bar 1 whose name contains "{_esc(target_file)}"\n'
        f'            if (count of _menuItems) > 0 then\n'
        f'                click (item 1 of _menuItems)\n'
        f'                delay 0.5\n'
        f'            end if\n'
        f'        end try\n'
        f'    end tell\n'
        f'end tell\n'
    )

    return _post_json(
        f"{companion_url}/trigger",
        {"raw_applescript": applescript},
    )


# ---------------------------------------------------------------------------
# Tier 1
# ---------------------------------------------------------------------------

def _write_clipboard(xml: str, plugin_url: str | None, plugin_token: str | None,
                     companion_url: str) -> dict:
    """Write XML to FM clipboard. Prefers plugin if available, falls back to companion."""
    if plugin_url and plugin_token:
        result = _post_json(f"{plugin_url}/api/clipboard/write", {"xml": xml}, token=plugin_token)
        if result.get("success"):
            return result
    return _post_json(f"{companion_url}/clipboard", {"xml": xml})


def _tier1(
    xml: str,
    companion_url: str,
    target_script: str | None,
    target_file: str | None = None,
    plugin_url: str | None = None,
    plugin_token: str | None = None,
) -> dict:
    """Write XML to clipboard, return paste instructions."""
    result = _write_clipboard(xml, plugin_url, plugin_token, companion_url)
    if not result.get("success"):
        return {
            "success": False,
            "tier_used": 1,
            "error": result.get("error", "Clipboard write failed"),
        }

    file_hint = f" in **{target_file}**" if target_file else ""
    if target_script:
        instructions = (
            f"Script loaded to clipboard.\n"
            f"  1. In FM Pro open '{target_script}'{file_hint} in Script Workspace\n"
            f"  2. Select all steps (⌘A)\n"
            f"  3. Paste (⌘V)"
        )
    else:
        instructions = (
            f"Script loaded to clipboard.\n"
            f"  Paste (⌘V) into the target script{file_hint} in Script Workspace."
        )

    return {"success": True, "tier_used": 1, "instructions": instructions}


# ---------------------------------------------------------------------------
# Tier 2
# ---------------------------------------------------------------------------

def _paste_applescript(fm_app_name: str, target_script: str, select_all: bool, auto_save: bool) -> str:
    """Build the raw AppleScript for Phase 2: AXPress tab + paste.

    This runs from outside FM (via companion osascript), not from within
    a Perform AppleScript step. AXPress only works from outside FM —
    Perform AppleScript within FM causes Script Workspace to lose focus.
    """
    def _esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')

    fm_process = fm_app_name.split(" \u2014 ")[0].strip()

    # Build the select+delete block if replacing
    if select_all:
        paste_block = (
            f'        keystroke "a" using {{command down}}\n'
            f'        delay 0.2\n'
            f'        key code 51\n'
            f'        delay 0.2\n'
            f'        keystroke "v" using {{command down}}\n'
        )
    else:
        paste_block = (
            f'        keystroke "v" using {{command down}}\n'
        )

    # Build auto-save block
    save_block = ""
    if auto_save:
        save_block = (
            f'        delay 0.5\n'
            f'        keystroke "s" using {{command down}}\n'
        )

    return (
        f'tell application "{_esc(fm_app_name)}"\n'
        f'    activate\n'
        f'end tell\n'
        f'\n'
        f'delay 0.3\n'
        f'\n'
        f'tell application "System Events"\n'
        f'    tell process "{_esc(fm_process)}"\n'
        # AXPress the script tab to move focus to step editor
        f'        set wsWindows to windows whose title contains "Script Workspace"\n'
        f'        if (count of wsWindows) > 0 then\n'
        f'            tell item 1 of wsWindows\n'
        f'                tell splitter group 1\n'
        f'                    set tabButtons to every button whose description is "{_esc(target_script)}"\n'
        f'                    if (count of tabButtons) > 0 then\n'
        f'                        perform action "AXPress" of item 1 of tabButtons\n'
        f'                    end if\n'
        f'                end tell\n'
        f'            end tell\n'
        f'        end if\n'
        f'        delay 0.5\n'
        # Paste sequence
        f'{paste_block}'
        f'{save_block}'
        f'    end tell\n'
        f'end tell\n'
    )


def _tier2(
    xml: str,
    companion_url: str,
    fm_app_name: str,
    target_script: str | None,
    auto_save: bool = False,
    select_all: bool = True,
    target_file: str | None = None,
) -> dict:
    """Two-phase deploy: FM opens the script tab, companion pastes from outside.

    Phase 1 — FM-side (do script "Agentic-fm Paste"):
      Activates FM, opens Script Workspace, opens the target script tab
      via MBS ScriptWorkspace.OpenScript. Then exits.

    Phase 2 — Companion-side (raw AppleScript via osascript):
      AXPress the tab button to focus the step editor, then
      Cmd+A → Delete → Cmd+V (or just Cmd+V for append).
      AXPress must run from outside FM — Perform AppleScript within FM
      causes Script Workspace to lose focus on the step editor.
    """
    # Step 1: load clipboard
    clip_result = _post_json(f"{companion_url}/clipboard", {"xml": xml})
    if not clip_result.get("success"):
        return {
            "success": False,
            "tier_used": 2,
            "error": clip_result.get("error", "Clipboard write failed"),
        }

    if not target_script:
        return {
            "success": True,
            "tier_used": 2,
            "instructions": (
                "Script loaded to clipboard. No target script specified — paste manually (⌘V)."
            ),
        }

    # Step 2: if targeting a specific file, switch its window to front first.
    # FM gates do-script privilege checks on the frontmost document — if the
    # wrong file is frontmost and lacks fmextscriptaccess, do-script fails
    # with -10004 even when the tell-document targets the correct file.
    if target_file:
        _switch_to_document(companion_url, fm_app_name, target_file)

    # Phase 1: trigger FM Pro to run Agentic-fm Paste (opens script tab only)
    trigger_payload = {
        "fm_app_name": fm_app_name,
        "script": "Agentic-fm Paste",
        "parameter": target_script,
    }
    if target_file:
        trigger_payload["target_file"] = target_file

    trigger_result = _post_json(f"{companion_url}/trigger", trigger_payload)
    if not trigger_result.get("success"):
        # Fall back to Tier 1 instructions — clipboard is already loaded
        file_hint = f" in **{target_file}**" if target_file else ""
        return {
            "success": True,
            "tier_used": 1,
            "fallback_from": 2,
            "fallback_reason": trigger_result.get("error", "Trigger failed"),
            "instructions": (
                f"Auto-paste unavailable — clipboard is loaded, paste manually.\n"
                f"  1. In FM Pro open '{target_script}'{file_hint} in Script Workspace\n"
                f"  2. Select all steps (⌘A)\n"
                f"  3. Paste (⌘V)"
            ),
        }

    # Phase 2: AXPress tab + paste from outside FM
    paste_as = _paste_applescript(fm_app_name, target_script, select_all, auto_save)
    paste_result = _post_json(
        f"{companion_url}/trigger",
        {"raw_applescript": paste_as},
    )
    if not paste_result.get("success"):
        return {
            "success": True,
            "tier_used": 1,
            "fallback_from": 2,
            "fallback_reason": f"Script opened but paste failed: {paste_result.get('error', 'unknown')}",
            "instructions": (
                f"Script '{target_script}' is open but paste failed.\n"
                f"  Clipboard is loaded — paste manually (⌘A → Delete → ⌘V)."
            ),
        }

    mode = "replaced" if select_all else "appended to"
    return {
        "success": True,
        "tier_used": 2,
        "message": f"Script steps {mode} '{target_script}' via Tier 2.",
    }


# ---------------------------------------------------------------------------
# Tier 3
# ---------------------------------------------------------------------------

def _is_local_macos() -> bool:
    """True when deploy.py is running natively on macOS, not in a container.

    When False, osascript is not available locally. All AppleScript execution
    is delegated to the companion server on the macOS host via /trigger.
    The Accessibility pre-flight check is skipped — the companion's terminal
    process (not the agent's container) must hold Accessibility permission.
    """
    return sys.platform == "darwin"


def _check_accessibility() -> tuple[bool, str]:
    """Check whether the calling process has macOS Accessibility permission.

    Only meaningful when running natively on macOS (_is_local_macos() is True).
    In a container or non-macOS environment, skip this check entirely — the
    companion server on the macOS host runs osascript, and its process is the
    one that needs Accessibility permission.

    Runs a minimal System Events AppleScript. If Accessibility access has not
    been granted to the terminal / shell executing this script, macOS blocks
    the call and returns an error containing 'not authorized' or error code
    -1743. The check is fast (~0.3 s) and silent on success.

    Returns:
        (True, "")            — permission granted, safe to proceed
        (False, reason_str)   — permission denied; reason_str is a human-
                                readable explanation with remediation steps
    """
    try:
        result = subprocess.run(
            ["osascript", "-e", 'tell application "System Events" to get name of first process'],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return True, ""
        err = result.stderr.strip().lower()
        if "not authorized" in err or "1743" in err or "accessibility" in err or "assistive" in err:
            terminal = os.environ.get("TERM_PROGRAM") or os.environ.get("LC_TERMINAL") or "your terminal app"
            return False, (
                f"Tier 3 requires Accessibility permission for '{terminal}'.\n"
                f"\n"
                f"  1. Open System Settings → Privacy & Security → Accessibility\n"
                f"  2. Add '{terminal}' (or the app running this shell) and enable it\n"
                f"  3. Re-run the deploy command\n"
                f"\n"
                f"  If the app is already listed but toggled off, toggle it off and back on.\n"
                f"  macOS may have shown an authorization dialog — check for it behind other windows."
            )
        return False, f"System Events error: {result.stderr.strip()}"
    except FileNotFoundError:
        return False, "osascript not found — Tier 3 requires macOS."
    except subprocess.TimeoutExpired:
        return False, "Accessibility check timed out."


def _tier3(
    xml: str,
    companion_url: str,
    fm_app_name: str,
    target_script: str | None,
    auto_save: bool = False,
    target_file: str | None = None,
) -> dict:
    """Create and name a script via monolithic AppleScript, then paste steps.

    Loads XML to clipboard first, then runs a raw AppleScript on the host
    (synchronous — waits for completion):
      0. Switch to Standard FileMaker Menus via Tools > Custom Menus
         (guards against custom menu sets that hide the Scripts menu)
      1. Open Script Workspace if not already open
      2. Cmd+N  → creates "New Script"
      3. Scripts menu → Rename Script → type target name → Return
      4. Cmd+S  → save (required before do script, or FM blocks with dialog)
      5. Cmd+A  → select all steps
      6. Delete  → remove default step
      7. Cmd+V  → paste from clipboard (already loaded in step 0)
      8. Cmd+S  → save after paste (always — new scripts are always saved)

    Notes:
      - tell application uses fm_app_name (versioned, with em dash)
      - tell process uses the base name only ("FileMaker Pro") — System Events
        process names never include the version suffix
      - raw_applescript is synchronous; clipboard must be loaded before firing
      - paste is done inline via System Events Cmd+V, not via Agentic-fm Paste
      - Custom menu guard ensures Scripts menu is always available
    """
    if not target_script:
        return _tier2(xml, companion_url, fm_app_name, target_script, auto_save, target_file=target_file)

    # Pre-flight: verify Accessibility permission before doing any work.
    # Only when running natively on macOS — in a container, AppleScript
    # runs on the companion host and its process needs the permission.
    if _is_local_macos():
        accessible, reason = _check_accessibility()
        if not accessible:
            return {
                "success": False,
                "tier_used": 3,
                "error": f"Accessibility permission required for Tier 3.\n{reason}",
            }

    # Step 0: load clipboard before firing the AppleScript
    clip_result = _post_json(f"{companion_url}/clipboard", {"xml": xml})
    if not clip_result.get("success"):
        return {
            "success": False,
            "tier_used": 3,
            "error": clip_result.get("error", "Clipboard write failed"),
        }

    def _esc(s: str) -> str:
        """Escape a string for embedding inside an AppleScript double-quoted string."""
        return s.replace("\\", "\\\\").replace('"', '\\"')

    # System Events process name — always the base app name without version suffix.
    # "FileMaker Pro — 22.0.4.406" → "FileMaker Pro"
    fm_process = fm_app_name.split(" \u2014 ")[0].strip()

    # Build the document-targeting preamble. When target_file is set:
    #   1. Switch to Standard FM Menus (so Window menu is available)
    #   2. Use Window menu to bring the target file's window to front
    #   3. Switch to Standard FM Menus again (the target file may have
    #      its own custom menus that replaced the menu bar on switch)
    # When no target_file, just do the standard menu switch once.
    if target_file:
        doc_targeting = (
            # First: switch to standard menus on whatever file is frontmost
            # so the Window menu becomes available
            f'        try\n'
            f'            click menu item "[Standard FileMaker Menus]" of menu "Custom Menus" of menu item "Custom Menus" of menu "Tools" of menu bar 1\n'
            f'            delay 0.3\n'
            f'        end try\n'
            # Use Window menu to bring the target file's window to front.
            # Menu item name is the window title which may differ from
            # the file name, but typically contains it.
            f'        try\n'
            f'            set _menuItems to every menu item of menu "Window" of menu bar 1 whose name contains "{_esc(target_file)}"\n'
            f'            if (count of _menuItems) > 0 then\n'
            f'                click (item 1 of _menuItems)\n'
            f'                delay 0.5\n'
            f'            end if\n'
            f'        end try\n'
            # Now the target file is frontmost — switch its menus to
            # standard too (it may have its own custom menu set)
            f'        try\n'
            f'            click menu item "[Standard FileMaker Menus]" of menu "Custom Menus" of menu item "Custom Menus" of menu "Tools" of menu bar 1\n'
            f'            delay 0.3\n'
            f'        end try\n'
        )
    else:
        doc_targeting = (
            # No multi-file targeting — just ensure standard menus
            f'        try\n'
            f'            click menu item "[Standard FileMaker Menus]" of menu "Custom Menus" of menu item "Custom Menus" of menu "Tools" of menu bar 1\n'
            f'            delay 0.3\n'
            f'        end try\n'
        )

    applescript = (
        f'tell application "{_esc(fm_app_name)}"\n'
        f'    activate\n'
        f'end tell\n'
        f'\n'
        f'delay 0.5\n'
        f'\n'
        f'tell application "System Events"\n'
        f'    tell process "{_esc(fm_process)}"\n'
        f'{doc_targeting}'
        # Open Script Workspace (try/end try — may already be open)
        f'        try\n'
        f'            click menu item "Script Workspace..." of menu "Scripts" of menu bar 1\n'
        f'            delay 1.0\n'
        f'        end try\n'
        # Create new script
        f'        keystroke "n" using {{command down}}\n'
        f'        delay 0.5\n'
        # Rename the new script
        f'        click menu item "Rename Script" of menu "Scripts" of menu bar 1\n'
        f'        delay 1.0\n'
        f'        keystroke "{_esc(target_script)}"\n'
        f'        delay 0.2\n'
        f'        key code 36\n'
        f'        delay 0.5\n'
        # Paste → Save (new script has no existing steps — no select/delete needed)
        f'        keystroke "v" using {{command down}}\n'
        f'        delay 0.5\n'
        f'        keystroke "s" using {{command down}}\n'
        f'        delay 0.3\n'
        f'    end tell\n'
        f'end tell\n'
    )

    create_result = _post_json(
        f"{companion_url}/trigger",
        {"raw_applescript": applescript},
    )
    if not create_result.get("success"):
        # Script creation failed — fall through to Tier 2 (paste into existing)
        # Clipboard is already loaded so Tier 2 can skip the clipboard step.
        tier2_result = _tier2(
            xml, companion_url, fm_app_name, target_script, auto_save,
            target_file=target_file,
        )
        return {
            **tier2_result,
            "fallback_from": 3,
            "fallback_reason": create_result.get("error", "Script creation failed"),
        }

    return {
        "success": True,
        "tier_used": 3,
        "message": f"Script '{target_script}' created, steps pasted, and saved via Tier 3.",
    }


# ---------------------------------------------------------------------------
# Tier 4 — direct plugin deploy (no AppleScript)
# ---------------------------------------------------------------------------

def _tier4(
    xml: str,
    plugin_url: str,
    plugin_token: str,
    target_script: str | None,
    select_all: bool = True,
) -> dict:
    """Deploy using the plugin's direct Script Workspace API.

    1. Navigate to the target script via /api/ui/script/navigate
    2. If select_all: delete all existing steps via /api/ui/script/delete
    3. Insert steps via /api/ui/script/insert
    4. Save via /api/ui/script/save

    Falls back to Tier 1 clipboard-only if the plugin calls fail.
    """
    if not target_script:
        result = _post_json(
            f"{plugin_url}/api/clipboard/write", {"xml": xml}, token=plugin_token
        )
        if not (result.get("success") or result.get("ok")):
            return {"success": False, "tier_used": 4, "error": result.get("error", "Clipboard write failed")}
        return {
            "success": True,
            "tier_used": 4,
            "instructions": "Script loaded to clipboard. No target script specified — paste manually (⌘V).",
        }

    # Step 1: navigate to the script — only if it isn't already open
    current = _get_json(f"{plugin_url}/api/ui/script", token=plugin_token)
    if current.get("scriptName") != target_script:
        nav = _post_json(
            f"{plugin_url}/api/ui/script/navigate",
            {"scriptName": target_script},
            token=plugin_token,
            timeout=35,
        )
        if not (nav.get("success") or nav.get("ok")):
            return {
                "success": False,
                "tier_used": 4,
                "error": nav.get("error", f"Could not navigate to '{target_script}'"),
            }

    # Step 2: delete existing steps if replacing — read step count first, then
    # delete by explicit index list (the API does not support {"all": true})
    if select_all:
        script_state = _get_json(f"{plugin_url}/api/ui/script", token=plugin_token)
        step_count = script_state.get("stepCount", 0)
        if step_count > 0:
            del_result = _post_json(
                f"{plugin_url}/api/ui/script/delete",
                {"steps": list(range(step_count))},
                token=plugin_token,
            )
            if not (del_result.get("success") or del_result.get("ok")):
                return {
                    "success": False,
                    "tier_used": 4,
                    "error": del_result.get("error", "Failed to delete existing steps"),
                }

    # Step 3: insert new steps (afterIndex -1 = beginning / after all deletions)
    insert_result = _post_json(
        f"{plugin_url}/api/ui/script/insert",
        {"xml": xml, "afterIndex": -1},
        token=plugin_token,
    )
    if not (insert_result.get("success") or insert_result.get("ok")):
        return {
            "success": False,
            "tier_used": 4,
            "error": insert_result.get("error", "Failed to insert steps"),
        }

    # Step 4: save
    save_result = _post_json(
        f"{plugin_url}/api/ui/script/save",
        {},
        token=plugin_token,
    )
    if not (save_result.get("success") or save_result.get("ok")):
        return {
            "success": False,
            "tier_used": 4,
            "error": save_result.get("error", "Failed to save script"),
        }

    mode = "replaced" if select_all else "appended to"
    return {
        "success": True,
        "tier_used": 4,
        "message": f"Script steps {mode} '{target_script}' via Tier 4 (plugin direct).",
    }


# ---------------------------------------------------------------------------
# Tier 4 — patch mode (surgical step edits via plugin)
# ---------------------------------------------------------------------------

def _tier4_patch(
    patch: dict,
    plugin_url: str,
    plugin_token: str,
) -> dict:
    """Apply a structured list of surgical edits to a script via the plugin.

    Patch payload schema:
        {
            "script": "Script Name",          # required
            "changes": [                       # required, applied in order
                {"op": "insert",  "afterIndex": N, "xml": "<fmxmlsnippet...>"},
                {"op": "delete",  "steps": [N, ...]},
                {"op": "replace", "steps": [N, ...], "xml": "<fmxmlsnippet...>"}
            ]
        }

    Op semantics:
        insert  — insert XML after step index N (-1 = before step 0)
        delete  — delete the listed step indices
        replace — delete listed indices, then insert XML at their vacated position
                  (inserts after index steps[0]-1, i.e. where the first deleted step was)

    IMPORTANT — index stability:
        Step indices shift as changes are applied. Apply changes in reverse index
        order (highest first) to keep earlier indices stable, matching the convention
        used by text-editor diff tools.

    Returns the standard result dict with success/tier_used/message/error.
    """
    script_name = patch.get("script")
    changes = patch.get("changes")

    if not script_name:
        return {"success": False, "tier_used": 4, "error": "Patch payload missing 'script' field"}
    if not isinstance(changes, list) or not changes:
        return {"success": False, "tier_used": 4, "error": "Patch payload missing or empty 'changes' list"}

    # Navigate to the script
    nav = _post_json(
        f"{plugin_url}/api/ui/script/navigate",
        {"scriptName": script_name},
        token=plugin_token,
        timeout=35,
    )
    if not nav.get("success", nav.get("ok")):
        return {
            "success": False,
            "tier_used": 4,
            "error": nav.get("error", f"Could not navigate to '{script_name}'"),
        }

    # Apply each change in order
    for i, change in enumerate(changes):
        op = change.get("op")
        prefix = f"Change {i+1} ({op})"

        if op == "insert":
            after = change.get("afterIndex", -1)
            xml = change.get("xml", "")
            if not xml:
                return {"success": False, "tier_used": 4, "error": f"{prefix}: missing 'xml'"}
            result = _post_json(
                f"{plugin_url}/api/ui/script/insert",
                {"xml": xml, "afterIndex": after},
                token=plugin_token,
            )
            if not result.get("success", result.get("ok")):
                return {"success": False, "tier_used": 4, "error": f"{prefix}: {result.get('error', 'insert failed')}"}

        elif op == "delete":
            steps = change.get("steps")
            if not isinstance(steps, list) or not steps:
                return {"success": False, "tier_used": 4, "error": f"{prefix}: missing 'steps' array"}
            result = _post_json(
                f"{plugin_url}/api/ui/script/delete",
                {"steps": steps},
                token=plugin_token,
            )
            if not result.get("success", result.get("ok")):
                return {"success": False, "tier_used": 4, "error": f"{prefix}: {result.get('error', 'delete failed')}"}

        elif op == "replace":
            steps = change.get("steps")
            xml = change.get("xml", "")
            if not isinstance(steps, list) or not steps:
                return {"success": False, "tier_used": 4, "error": f"{prefix}: missing 'steps' array"}
            if not xml:
                return {"success": False, "tier_used": 4, "error": f"{prefix}: missing 'xml'"}
            # Delete the target steps first
            del_result = _post_json(
                f"{plugin_url}/api/ui/script/delete",
                {"steps": steps},
                token=plugin_token,
            )
            if not del_result.get("success", del_result.get("ok")):
                return {"success": False, "tier_used": 4, "error": f"{prefix}: delete phase: {del_result.get('error', 'failed')}"}
            # Insert at the vacated position (before where the first step was)
            insert_after = steps[0] - 1
            ins_result = _post_json(
                f"{plugin_url}/api/ui/script/insert",
                {"xml": xml, "afterIndex": insert_after},
                token=plugin_token,
            )
            if not ins_result.get("success", ins_result.get("ok")):
                return {"success": False, "tier_used": 4, "error": f"{prefix}: insert phase: {ins_result.get('error', 'failed')}"}

        else:
            return {"success": False, "tier_used": 4, "error": f"{prefix}: unknown op '{op}' (expected insert/delete/replace)"}

    # Save
    save = _post_json(f"{plugin_url}/api/ui/script/save", {}, token=plugin_token)
    if not save.get("success", save.get("ok")):
        return {"success": False, "tier_used": 4, "error": f"Save failed: {save.get('error', 'unknown')}"}

    return {
        "success": True,
        "tier_used": 4,
        "message": f"Applied {len(changes)} change(s) to '{script_name}' via patch.",
    }


# ---------------------------------------------------------------------------
# Schema modification via ModifySchema script
# ---------------------------------------------------------------------------

def modify_schema(sql: str) -> dict:
    """Execute a DDL statement via the ModifySchema script through AGFM_Bridge.

    Args:
        sql: A DDL statement e.g. "CREATE TABLE Foo (id VARCHAR(255))"

    Returns:
        Result dict with success/message/error.
    """
    import time

    config = _load_config()
    plugin_url = (config.get("plugin_url") or "").rstrip("/") or None
    plugin_token = config.get("plugin_token") or None

    if not plugin_url or not plugin_token:
        return {"success": False, "error": "modify_schema() requires plugin_url and plugin_token"}

    result = _post_json(
        f"{plugin_url}/api/performscript",
        {
            "scriptName": "AGFM_Bridge",
            "parameter": {
                "command": "performScript",
                "scriptName": "ModifySchema",
                "parameter": sql,
            },
        },
        token=plugin_token,
    )

    eval_id = result.get("id")
    if not eval_id:
        return {"success": False, "error": result.get("error", "No eval ID returned")}

    time.sleep(5)
    eval_result = _get_json(f"{plugin_url}/api/eval/{eval_id}", token=plugin_token)

    if not eval_result.get("complete"):
        return {"success": False, "error": "ModifySchema did not complete in time"}

    inner = eval_result.get("result", {})
    script_error = inner.get("scriptError", -1)
    script_result = inner.get("result", "")

    # result "0" = success, non-zero = error
    if script_error != 0 or script_result != "0":
        return {
            "success": False,
            "error": f"ModifySchema failed — scriptError: {script_error}, result: {script_result!r}",
        }

    # Verify by querying FileMaker_Tables
    verify = _post_json(
        f"{plugin_url}/api/query",
        {"sql": "SELECT TableName FROM FileMaker_Tables ORDER BY TableName"},
        token=plugin_token,
    )
    verify_id = verify.get("id")
    if verify_id:
        time.sleep(2)
        verify_result = _get_json(f"{plugin_url}/api/eval/{verify_id}", token=plugin_token)
        tables = verify_result.get("result", {}).get("result", "")
    else:
        tables = "(could not verify)"

    return {
        "success": True,
        "message": f"DDL executed successfully.\nCurrent tables:\n{tables}",
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def patch(
    patch_path_or_dict: "str | dict",
) -> dict:
    """Apply a structured list of surgical step edits to a script via the plugin.

    Args:
        patch_path_or_dict: Path to a JSON patch file, or a dict with the patch payload.

    Patch payload schema:
        {
            "script": "Script Name",
            "changes": [
                {"op": "insert",  "afterIndex": N, "xml": "<fmxmlsnippet...>"},
                {"op": "delete",  "steps": [N, ...]},
                {"op": "replace", "steps": [N, ...], "xml": "<fmxmlsnippet...>"}
            ]
        }

    Returns:
        Result dict with success/tier_used/message/error.
    """
    config = _load_config()
    plugin_url = (config.get("plugin_url") or "").rstrip("/") or None
    plugin_token = config.get("plugin_token") or None

    if not plugin_url or not plugin_token:
        return {
            "success": False,
            "tier_used": 4,
            "error": "patch() requires plugin_url and plugin_token — plugin must be available",
        }

    if isinstance(patch_path_or_dict, dict):
        payload = patch_path_or_dict
    else:
        try:
            with open(patch_path_or_dict, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except (OSError, ValueError) as exc:
            return {"success": False, "tier_used": 4, "error": f"Cannot read patch file: {exc}"}

    return _tier4_patch(payload, plugin_url, plugin_token)


def deploy(
    xml_path: str,
    target_script: str | None = None,
    tier: int | None = None,
    auto_save: bool | None = None,
    select_all: bool = True,
    target_file: str | None = None,
) -> dict:
    """Deploy a validated fmxmlsnippet XML file to FileMaker.

    Args:
        xml_path:      Path to the fmxmlsnippet XML file.
        target_script: Name of the script to paste into (Tier 2/3).
        tier:          Override the configured default tier (1, 2, or 3).
        auto_save:     Override the configured auto_save setting.
        select_all:    Replace (True) or append (False) existing steps (Tier 2).
        target_file:   FM file name to target (for multi-file solutions).
                       Auto-resolved from CONTEXT.json or automation.json if None.

    Returns:
        Result dict — always contains 'success' and 'tier_used'.
        Tier 1 / fallback: also contains 'instructions' to show the developer.
        Tier 2/3 success: also contains 'message' for logging.
    """
    config = _load_config()
    effective_auto_save = auto_save if auto_save is not None else bool(config.get("auto_save", False))
    companion_url = config.get("companion_url", "http://local.hub:8767").rstrip("/")
    fm_app_name = config.get("fm_app_name", "FileMaker Pro")
    plugin_url = (config.get("plugin_url") or "").rstrip("/") or None
    plugin_token = config.get("plugin_token") or None

    # Auto-upgrade to Tier 4 when plugin creds are present and no explicit tier was requested.
    if tier is not None:
        effective_tier = tier
    elif plugin_url and plugin_token:
        effective_tier = 4
    else:
        effective_tier = config.get("default_tier", 1)

    # Auto-resolve target file if not provided
    if target_file is None:
        target_file = _resolve_target_file(config)

    try:
        with open(xml_path, "r", encoding="utf-8") as f:
            xml = f.read()
    except OSError as exc:
        return {"success": False, "error": f"Cannot read {xml_path}: {exc}"}

    if effective_tier == 4:
        if plugin_url and plugin_token:
            return _tier4(xml, plugin_url, plugin_token, target_script, select_all)
        return {
            "success": False,
            "tier_used": 4,
            "error": "Tier 4 requires plugin_url and plugin_token in agent/auth/plugin.json",
        }
    elif effective_tier == 3:
        return _tier3(xml, companion_url, fm_app_name, target_script, effective_auto_save, target_file)
    elif effective_tier == 2:
        return _tier2(xml, companion_url, fm_app_name, target_script, effective_auto_save, select_all, target_file)
    else:
        return _tier1(xml, companion_url, target_script, target_file, plugin_url, plugin_token)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Deploy a validated fmxmlsnippet XML file to FileMaker.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument("xml_path", nargs="?", help="Path to the fmxmlsnippet XML file")
    mode_group.add_argument(
        "--patch", metavar="PATCH_FILE",
        help="Path to a JSON patch file describing surgical step edits (plugin required)",
    )
    mode_group.add_argument(
        "--install-scripts", action="store_true",
        help="Deploy all bundled agentic-fm helper scripts (e.g. ModifySchema) into the current solution",
    )
    mode_group.add_argument(
        "--ddl", metavar="SQL",
        help="Execute a DDL statement via ModifySchema (plugin required). Verifies result after execution.",
    )
    parser.add_argument(
        "target_script", nargs="?", help="Script name to paste into (Tier 2/3/4, deploy mode only)"
    )
    parser.add_argument(
        "--tier", type=int, choices=[1, 2, 3, 4], help="Override deployment tier (deploy mode only)"
    )
    parser.add_argument(
        "--auto-save", action="store_true", default=None, dest="auto_save",
        help="Auto-save the script after paste (Tier 2/3 only)"
    )
    parser.add_argument(
        "--no-auto-save", action="store_false", dest="auto_save",
        help="Do not auto-save after paste (overrides config)"
    )
    parser.add_argument(
        "--file", dest="target_file", default=None,
        help="FM file name to target (for multi-file solutions). Auto-resolved if omitted."
    )
    paste_group = parser.add_mutually_exclusive_group()
    paste_group.add_argument(
        "--replace", action="store_true", default=False,
        help="Replace all existing steps without prompting (Tier 2/4 only)"
    )
    paste_group.add_argument(
        "--append", action="store_true", default=False,
        help="Append after existing steps without prompting (Tier 2/4 only)"
    )
    args = parser.parse_args()

    # --- DDL mode ---
    if args.ddl:
        result = modify_schema(args.ddl)
        if result.get("message"):
            print(result["message"])
        elif result.get("error"):
            print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(0 if result.get("success") else 1)

    # --- Install scripts mode ---
    if args.install_scripts:
        here = os.path.dirname(os.path.abspath(__file__))
        scripts_dir = os.path.join(here, "..", "filemaker")
        bundled = [
            ("ModifySchema.xml", "ModifySchema"),
        ]
        all_ok = True
        for filename, script_name in bundled:
            xml_path = os.path.join(scripts_dir, filename)
            if not os.path.exists(xml_path):
                print(f"  SKIP {script_name} — {xml_path} not found", file=sys.stderr)
                continue
            result = deploy(xml_path, target_script=script_name, tier=1)
            if result.get("success"):
                print(f"  {script_name} is on the clipboard.")
                print(f"    1. Open Script Workspace in FileMaker")
                print(f"    2. ⌘V — paste")
            elif result.get("error"):
                print(f"  {script_name}: ERROR — {result['error']}", file=sys.stderr)
                all_ok = False
        sys.exit(0 if all_ok else 1)

    # --- Patch mode ---
    if args.patch:
        result = patch(args.patch)
        if result.get("message"):
            print(result["message"])
        elif result.get("error"):
            print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(0 if result.get("success") else 1)

    # --- Deploy mode ---
    # Tiers 2 and 4 targeting an existing script are destructive — always confirm
    # unless --replace or --append bypasses the prompt explicitly.
    select_all = True
    cfg = _load_config()
    _pu = (cfg.get("plugin_url") or "").rstrip("/") or None
    _pt = cfg.get("plugin_token") or None
    if args.tier is not None:
        effective_tier = args.tier
    elif _pu and _pt:
        effective_tier = 4
    else:
        effective_tier = cfg.get("default_tier", 1)
    if effective_tier in (2, 4) and args.target_script:
        if args.append:
            select_all = False
        elif not args.replace:
            print(f"\nScript '{args.target_script}' will be modified.")
            print("  [r] Replace — select all existing steps and paste (destructive)")
            print("  [a] Append  — paste after existing steps")
            print("  [c] Cancel")
            try:
                choice = input("Choice [r/a/c]: ").strip().lower()
            except (KeyboardInterrupt, EOFError):
                print("\nCancelled.")
                sys.exit(0)
            if choice == "c":
                print("Cancelled.")
                sys.exit(0)
            elif choice == "a":
                select_all = False

    result = deploy(args.xml_path, args.target_script, args.tier, args.auto_save, select_all, args.target_file)

    # Human-friendly output
    if result.get("instructions"):
        print(result["instructions"])
    elif result.get("message"):
        print(result["message"])
    elif result.get("error"):
        print(f"Error: {result['error']}", file=sys.stderr)

    if result.get("fallback_from"):
        print(
            f"(Fell back from Tier {result['fallback_from']}: {result.get('fallback_reason', '')})",
            file=sys.stderr,
        )

    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
