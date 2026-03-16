#!/usr/bin/env python3
"""
deploy.py - Pluggable deployment module for agentic-fm.

Loads a validated fmxmlsnippet XML file to the FileMaker clipboard and
optionally triggers an automated paste into the Script Workspace.

Tier 1 (universal):  companion /clipboard → developer pastes manually
Tier 2 (MBS):        companion /clipboard + /trigger → Agentic-fm Paste auto-pastes
Tier 3 (MBS + AS):   companion /trigger creates placeholder → then Tier 2

Usage (CLI):
    python3 agent/scripts/deploy.py <xml_path> [target_script] [--tier N]

Usage (module):
    from deploy import deploy
    result = deploy("agent/sandbox/MyScript.xml", target_script="My Script")

Result dict keys:
    success       — bool
    tier_used     — int (1, 2, or 3; may differ from requested if fallback)
    instructions  — str (Tier 1 and fallback cases — present to developer)
    message       — str (Tier 2/3 success — for logging)
    fallback_from — int (present when fell back from a higher tier)
    fallback_reason — str (why the fallback occurred)
    error         — str (present on failure)
"""

import argparse
import json
import os
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
    "companion_url": "http://local.hub:8765",
}


def _load_config() -> dict:
    here = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(here, "..", "config", "automation.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            return {**DEFAULT_CONFIG, **cfg}
    except (OSError, ValueError):
        return DEFAULT_CONFIG.copy()


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _post_json(url: str, payload: dict, timeout: int = 15) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
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
# Tier 1
# ---------------------------------------------------------------------------

def _tier1(xml: str, companion_url: str, target_script: str | None) -> dict:
    """Write XML to clipboard via companion, return paste instructions."""
    result = _post_json(f"{companion_url}/clipboard", {"xml": xml})
    if not result.get("success"):
        return {
            "success": False,
            "tier_used": 1,
            "error": result.get("error", "Clipboard write failed"),
        }

    if target_script:
        instructions = (
            f"Script loaded to clipboard.\n"
            f"  1. In FM Pro open '{target_script}' in Script Workspace\n"
            f"  2. Select all steps (⌘A)\n"
            f"  3. Paste (⌘V)"
        )
    else:
        instructions = (
            "Script loaded to clipboard.\n"
            "  Paste (⌘V) into the target script in Script Workspace."
        )

    return {"success": True, "tier_used": 1, "instructions": instructions}


# ---------------------------------------------------------------------------
# Tier 2
# ---------------------------------------------------------------------------

def _tier2(
    xml: str,
    companion_url: str,
    fm_app_name: str,
    target_script: str | None,
    auto_save: bool = False,
) -> dict:
    """Load clipboard then trigger FM Pro to run Agentic-fm Paste via AppleScript."""
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

    # Step 2: trigger FM Pro to run Agentic-fm Paste
    trigger_result = _post_json(
        f"{companion_url}/trigger",
        {
            "fm_app_name": fm_app_name,
            "script": "Agentic-fm Paste",
            "parameter": target_script,
            "auto_save": auto_save,
        },
    )
    if not trigger_result.get("success"):
        # Fall back to Tier 1 instructions — clipboard is already loaded
        return {
            "success": True,
            "tier_used": 1,
            "fallback_from": 2,
            "fallback_reason": trigger_result.get("error", "Trigger failed"),
            "instructions": (
                f"Auto-paste unavailable — clipboard is loaded, paste manually.\n"
                f"  1. In FM Pro open '{target_script}' in Script Workspace\n"
                f"  2. Select all steps (⌘A)\n"
                f"  3. Paste (⌘V)"
            ),
        }

    return {
        "success": True,
        "tier_used": 2,
        "message": f"Script pasted into '{target_script}' via MBS.",
    }


# ---------------------------------------------------------------------------
# Tier 3
# ---------------------------------------------------------------------------

def _tier3(
    xml: str,
    companion_url: str,
    fm_app_name: str,
    target_script: str | None,
    auto_save: bool = False,
) -> dict:
    """Create a script placeholder via AppleScript, then Tier 2 paste."""
    if not target_script:
        return _tier2(xml, companion_url, fm_app_name, target_script, auto_save)

    # Trigger FM Pro to run AGFMNewScript, which creates a blank placeholder
    create_result = _post_json(
        f"{companion_url}/trigger",
        {
            "fm_app_name": fm_app_name,
            "script": "AGFMNewScript",
            "parameter": target_script,
        },
    )
    if not create_result.get("success"):
        # Script creation failed — fall through to Tier 2 (paste into existing)
        tier2_result = _tier2(xml, companion_url, fm_app_name, target_script, auto_save)
        return {
            **tier2_result,
            "fallback_from": 3,
            "fallback_reason": create_result.get("error", "Script creation failed"),
        }

    return _tier2(xml, companion_url, fm_app_name, target_script, auto_save)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def deploy(
    xml_path: str,
    target_script: str | None = None,
    tier: int | None = None,
    auto_save: bool | None = None,
) -> dict:
    """
    Deploy a validated fmxmlsnippet XML file to FileMaker.

    Args:
        xml_path:      Path to the fmxmlsnippet XML file.
        target_script: Name of the script to paste into (Tier 2/3).
        tier:          Override the configured default tier (1, 2, or 3).
        auto_save:     Override the configured auto_save setting.

    Returns:
        Result dict — always contains 'success' and 'tier_used'.
        Tier 1 / fallback: also contains 'instructions' to show the developer.
        Tier 2/3 success: also contains 'message' for logging.
    """
    config = _load_config()
    effective_tier = tier if tier is not None else config.get("default_tier", 1)
    effective_auto_save = auto_save if auto_save is not None else bool(config.get("auto_save", False))
    companion_url = config.get("companion_url", "http://local.hub:8765").rstrip("/")
    fm_app_name = config.get("fm_app_name", "FileMaker Pro")

    try:
        with open(xml_path, "r", encoding="utf-8") as f:
            xml = f.read()
    except OSError as exc:
        return {"success": False, "error": f"Cannot read {xml_path}: {exc}"}

    if effective_tier == 3:
        return _tier3(xml, companion_url, fm_app_name, target_script, effective_auto_save)
    elif effective_tier == 2:
        return _tier2(xml, companion_url, fm_app_name, target_script, effective_auto_save)
    else:
        return _tier1(xml, companion_url, target_script)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Deploy a validated fmxmlsnippet XML file to FileMaker.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("xml_path", help="Path to the fmxmlsnippet XML file")
    parser.add_argument(
        "target_script", nargs="?", help="Script name to paste into (Tier 2/3)"
    )
    parser.add_argument(
        "--tier", type=int, choices=[1, 2, 3], help="Override deployment tier"
    )
    parser.add_argument(
        "--auto-save", action="store_true", default=None, dest="auto_save",
        help="Auto-save the script after paste (Tier 2/3 only)"
    )
    parser.add_argument(
        "--no-auto-save", action="store_false", dest="auto_save",
        help="Do not auto-save after paste (overrides config)"
    )
    args = parser.parse_args()

    result = deploy(args.xml_path, args.target_script, args.tier, args.auto_save)

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
