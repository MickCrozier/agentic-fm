#!/usr/bin/env python3
"""
agfm_bridge.py — Primary interface to the agentic-fm plugin.

When the plugin is available (AGFM_PLUGIN_URL + AGFM_PLUGIN_TOKEN in .env.local),
this module is the single entry point for all FM operations: context sync, SQL
queries, HR→XML conversion, script deployment, clipboard, linting, and DDL.

deploy.py remains for non-plugin fallbacks (Tier 1/2/3 via companion/AppleScript).
Use agfm_bridge when the plugin is reachable; deploy.py otherwise.

CLI usage:
    python3 agent/scripts/agfm_bridge.py status
    python3 agent/scripts/agfm_bridge.py context [--refresh] [--no-sync]
    python3 agent/scripts/agfm_bridge.py query "SELECT TableName FROM FileMaker_Tables"
    python3 agent/scripts/agfm_bridge.py deploy <file.fmscript> [script_name] [--append]
    python3 agent/scripts/agfm_bridge.py bundle <file1> [<file2> ...] [--names ...]
    python3 agent/scripts/agfm_bridge.py patch <patch.json>
    python3 agent/scripts/agfm_bridge.py convert <file.fmscript> [--out <file.xml>]
    python3 agent/scripts/agfm_bridge.py lint <file.fmscript>
    python3 agent/scripts/agfm_bridge.py clipboard-read
    python3 agent/scripts/agfm_bridge.py clipboard-write <file>
    python3 agent/scripts/agfm_bridge.py ddl "CREATE TABLE Foo (...)"

Module usage:
    from agent.scripts.agfm_bridge import PluginClient
    client = PluginClient.from_env()
    ctx = client.sync_context()
    rows = client.query("SELECT TableName FROM FileMaker_Tables")
    client.deploy("agent/sandbox/MyScript.fmscript", "My Script")
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HERE = Path(__file__).parent
_PROJECT_ROOT = (_HERE / ".." / "..").resolve()
_ENV_FILE = _PROJECT_ROOT / ".env.local"
_CONTEXT_PATH = _PROJECT_ROOT / "agent" / "CONTEXT.json"
_CONFIG_PATH = _PROJECT_ROOT / "agent" / "config" / "automation.json"


# ---------------------------------------------------------------------------
# HTTP helpers (no third-party deps)
# ---------------------------------------------------------------------------

def _http(method: str, url: str, payload: dict | None = None,
          token: str | None = None, timeout: int = 20) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        try:
            return json.loads(raw)
        except ValueError:
            return {"success": False, "error": f"HTTP {exc.code}: {raw[:400]}"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def _get(url, token=None, timeout=20):
    return _http("GET", url, token=token, timeout=timeout)


def _post(url, payload, token=None, timeout=20):
    return _http("POST", url, payload=payload, token=token, timeout=timeout)


# ---------------------------------------------------------------------------
# PluginClient
# ---------------------------------------------------------------------------

class PluginClient:
    """Authenticated client for the agentic-fm plugin REST API."""

    def __init__(self, url: str, token: str):
        self.url = url.rstrip("/")
        self.token = token

    # ── Auth ──────────────────────────────────────────────────────────────

    @classmethod
    def from_env(cls, env_path: Path = _ENV_FILE) -> "PluginClient":
        """Load credentials from .env.local. Raises RuntimeError if missing."""
        env: dict[str, str] = {}
        try:
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip()
        except OSError:
            pass
        url = env.get("AGFM_PLUGIN_URL")
        token = env.get("AGFM_PLUGIN_TOKEN")
        if not url or not token:
            raise RuntimeError(
                "AGFM_PLUGIN_URL and AGFM_PLUGIN_TOKEN must be set in .env.local"
            )
        return cls(url, token)

    def _get(self, path: str, timeout: int = 20) -> dict:
        return _get(f"{self.url}{path}", token=self.token, timeout=timeout)

    def _post(self, path: str, payload: dict, timeout: int = 20) -> dict:
        return _post(f"{self.url}{path}", payload, token=self.token, timeout=timeout)

    # ── Status ────────────────────────────────────────────────────────────

    def is_available(self) -> bool:
        """Return True if the plugin is reachable and responding."""
        try:
            r = self._get("/api/health", timeout=5)
            return bool(r.get("ok") or r.get("status") == "ok" or "version" in r)
        except Exception:
            return False

    def discover(self) -> list[dict]:
        """Return the list of available API endpoints."""
        r = self._get("/api/discover")
        return r.get("routes", r) if isinstance(r, dict) else r

    # ── Context ───────────────────────────────────────────────────────────

    def get_context(self, refresh: bool = False) -> dict:
        """Fetch current layout context from the plugin.

        Args:
            refresh: Call /api/context/refresh first to force FM to re-snapshot.

        Returns:
            Context dict (same schema as CONTEXT.json).
        """
        if refresh:
            self._post("/api/context/refresh", {})
            time.sleep(0.5)
        r = self._get("/api/context")
        if "error" in r and "solution" not in r:
            raise RuntimeError(f"get_context failed: {r['error']}")
        return r

    def sync_context(self, refresh: bool = False, path: Path = _CONTEXT_PATH) -> dict:
        """Fetch context from the plugin and write it to CONTEXT.json.

        This is the primary way to keep CONTEXT.json current when the plugin
        is running. fmlint and other tools read from CONTEXT.json automatically.

        Args:
            refresh: Force FM to re-snapshot before fetching.
            path:    Destination path (default: agent/CONTEXT.json).

        Returns:
            The context dict that was written.
        """
        ctx = self.get_context(refresh=refresh)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(ctx, f, indent=2, ensure_ascii=False)
        return ctx

    # ── SQL queries ───────────────────────────────────────────────────────

    def query(self, sql: str, timeout: int = 30) -> str:
        """Execute a FileMaker SQL query and return the result string.

        /api/query is async — this method polls /api/eval/:id until complete.

        Args:
            sql:     SQL statement (FileMaker SQL dialect).
            timeout: Maximum seconds to wait for the result.

        Returns:
            Raw result string from FileMaker (tab/newline delimited rows).

        Raises:
            RuntimeError on failure or timeout.
        """
        r = self._post("/api/query", {"sql": sql})
        eval_id = r.get("id")
        if not eval_id:
            raise RuntimeError(f"query failed: {r.get('error', r)}")

        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(0.5)
            poll = self._get(f"/api/eval/{eval_id}")
            if poll.get("complete"):
                result = poll.get("result", {})
                if isinstance(result, dict):
                    return result.get("result", "")
                return str(result)
        raise RuntimeError(f"query timed out after {timeout}s (eval_id={eval_id})")

    def poll_eval(self, eval_id: str, timeout: int = 30) -> dict:
        """Poll /api/eval/:id until complete. Returns the completed eval dict."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(0.5)
            r = self._get(f"/api/eval/{eval_id}")
            if r.get("complete"):
                return r
        raise RuntimeError(f"eval {eval_id} timed out after {timeout}s")

    # ── HR ↔ XML conversion ───────────────────────────────────────────────

    def hr_to_xml(self, hr: str) -> str:
        """Convert a human-readable .fmscript to fmxmlsnippet XML.

        Applies _patch_converted_xml to fix known plugin conversion bugs.

        Returns:
            XML string.

        Raises:
            RuntimeError on conversion failure.
        """
        r = self._post("/api/hr-to-xml", {"hr": hr})
        if not r.get("ok"):
            raise RuntimeError(f"hr_to_xml failed: {r.get('error', r)}")
        for w in r.get("conversionWarnings", []):
            print(f"  [warn] {w}", file=sys.stderr)
        return _patch_converted_xml(r["xml"], hr_source=hr)

    def xml_to_hr(self, xml: str) -> str:
        """Convert fmxmlsnippet XML to human-readable format."""
        r = self._post("/api/xml-to-hr", {"xml": xml})
        if not r.get("ok"):
            raise RuntimeError(f"xml_to_hr failed: {r.get('error', r)}")
        return r.get("hr", "")

    def validate_hr(self, hr: str) -> dict:
        """Validate a human-readable script. Returns the validation result dict."""
        return self._post("/api/validate-hr", {"hr": hr})

    # ── Clipboard ─────────────────────────────────────────────────────────

    def clipboard_write(self, xml: str) -> bool:
        """Write fmxmlsnippet XML to the FM clipboard. Returns True on success."""
        r = self._post("/api/clipboard/write", {"xml": xml, "type": "XMSS"})
        if r.get("success") or r.get("ok"):
            return True
        raise RuntimeError(f"clipboard_write failed: {r.get('error', r)}")

    def clipboard_read(self) -> str:
        """Read fmxmlsnippet XML from the FM clipboard. Returns XML string."""
        r = self._get("/api/clipboard")
        if not (r.get("success") or r.get("ok")):
            raise RuntimeError(f"clipboard_read failed: {r.get('error', r)}")
        return r.get("xml", "")

    # ── Script deployment ─────────────────────────────────────────────────

    def deploy(
        self,
        path: str,
        script_name: str | None = None,
        mode: str = "replace",
    ) -> dict:
        """Deploy a .fmscript or .xml file to FileMaker via the plugin.

        For existing scripts: navigates, deletes/appends, inserts, saves.
        For no script_name: writes to clipboard only (manual paste).

        Args:
            path:        Path to .fmscript or fmxmlsnippet .xml file.
            script_name: Target script name in FileMaker Script Workspace.
            mode:        'replace' (default) or 'append'.

        Returns:
            Result dict with success/message/instructions/error.
        """
        with open(path, encoding="utf-8") as f:
            raw = f.read()

        xml = self.hr_to_xml(raw) if path.endswith(".fmscript") else raw
        select_all = (mode != "append")

        if not script_name:
            self.clipboard_write(xml)
            return {
                "success": True,
                "instructions": "Script loaded to clipboard. Paste (⌘V) into the target script in Script Workspace.",
            }

        return self._deploy_xml(xml, script_name, select_all)

    def _deploy_xml(self, xml: str, script_name: str, select_all: bool = True) -> dict:
        """Internal: navigate → delete → insert → save."""
        # Navigate (skip if already open)
        current = self._get("/api/ui/script")
        if current.get("scriptName") != script_name:
            nav = self._post("/api/ui/script/navigate", {"scriptName": script_name}, timeout=35)
            if not (nav.get("success") or nav.get("ok")):
                return {"success": False, "error": nav.get("error", f"Cannot navigate to '{script_name}'")}

        # Delete existing steps
        if select_all:
            state = self._get("/api/ui/script")
            count = state.get("stepCount", 0)
            if count > 0:
                dr = self._post("/api/ui/script/delete", {"steps": list(range(1, count + 1))})
                if not (dr.get("success") or dr.get("ok")):
                    return {"success": False, "error": dr.get("error", "Delete existing steps failed")}
                # Wait for FM to complete deletion
                for _ in range(10):
                    time.sleep(0.3)
                    if self._get("/api/ui/script").get("stepCount", count) == 0:
                        break

        # Insert
        ir = self._post("/api/ui/script/insert", {"xml": xml, "afterIndex": -1, "type": "XMSS"})
        if not (ir.get("success") or ir.get("ok")):
            return {"success": False, "error": ir.get("error", "Insert steps failed")}

        # Save
        sr = self._post("/api/ui/script/save", {})
        if not (sr.get("success") or sr.get("ok")):
            return {"success": False, "error": sr.get("error", "Save failed")}

        mode = "replaced" if select_all else "appended to"
        return {"success": True, "message": f"'{script_name}' {mode} via plugin."}

    def bundle(self, files: list[str], names: list[str] | None = None) -> dict:
        """Create new scripts directly via the plugin (no clipboard paste required).

        Uses POST /api/ui/script/create for each file. Accepts multiple files,
        creating each script in sequence.

        Args:
            files: List of paths to .fmscript or .xml files.
            names: Script names (derived from filename if omitted).

        Returns:
            Result dict with success/created/error.
        """
        effective_names = list(names or [])
        while len(effective_names) < len(files):
            effective_names.append(None)

        created = []
        failed = []

        for path, name in zip(files, effective_names):
            with open(path, encoding="utf-8") as fp:
                raw = fp.read()
            xml = self.hr_to_xml(raw) if path.endswith(".fmscript") else raw

            if not name:
                name = os.path.splitext(os.path.basename(path))[0]

            r = self._post("/api/ui/script/create", {"scriptName": name, "xml": xml})
            if r.get("ok") or r.get("success"):
                created.append(name)
            else:
                failed.append((name, r.get("error", str(r))))

        if failed:
            msgs = "; ".join(f"{n}: {e}" for n, e in failed)
            return {"success": False, "created": created, "error": msgs}

        return {
            "success": True,
            "created": created,
            "message": f"Created {len(created)} script(s): {', '.join(repr(n) for n in created)}",
        }

    def patch(self, patch_data: str | dict) -> dict:
        """Apply surgical step-level edits to an existing script.

        Args:
            patch_data: Path to a JSON patch file, or a dict with the payload.

        Patch schema:
            {
                "script": "Script Name",
                "changes": [
                    {"op": "insert",  "afterIndex": N, "xml": "<fmxmlsnippet...>"},
                    {"op": "delete",  "steps": [N, ...]},
                    {"op": "replace", "steps": [N, ...], "xml": "<fmxmlsnippet...>"}
                ]
            }

        Returns:
            Result dict with success/message/error.
        """
        if isinstance(patch_data, str):
            with open(patch_data, encoding="utf-8") as f:
                payload = json.load(f)
        else:
            payload = patch_data

        script_name = payload.get("script")
        changes = payload.get("changes", [])
        if not script_name:
            return {"success": False, "error": "Patch missing 'script' field"}

        nav = self._post("/api/ui/script/navigate", {"scriptName": script_name}, timeout=35)
        if not (nav.get("success") or nav.get("ok")):
            return {"success": False, "error": nav.get("error", f"Cannot navigate to '{script_name}'")}

        for i, change in enumerate(changes):
            op = change.get("op")
            label = f"Change {i+1} ({op})"

            if op == "insert":
                r = self._post("/api/ui/script/insert",
                               {"xml": change["xml"], "afterIndex": change.get("afterIndex", -1)})
            elif op == "delete":
                r = self._post("/api/ui/script/delete", {"steps": change["steps"]})
            elif op == "replace":
                r = self._post("/api/ui/script/delete", {"steps": change["steps"]})
                if r.get("success") or r.get("ok"):
                    r = self._post("/api/ui/script/insert",
                                   {"xml": change["xml"], "afterIndex": change["steps"][0] - 1})
            else:
                return {"success": False, "error": f"{label}: unknown op '{op}'"}

            if not (r.get("success") or r.get("ok")):
                return {"success": False, "error": f"{label}: {r.get('error', 'failed')}"}

        sr = self._post("/api/ui/script/save", {})
        if not (sr.get("success") or sr.get("ok")):
            return {"success": False, "error": f"Save failed: {sr.get('error')}"}

        return {"success": True, "message": f"Applied {len(changes)} change(s) to '{script_name}'."}

    # ── Lint ──────────────────────────────────────────────────────────────

    def lint(self, path: str) -> dict:
        """Lint a .fmscript file via the plugin's /api/lint endpoint.

        Falls back to the local python3 -m agent.fmlint runner if the plugin
        lint endpoint is unavailable.

        Returns:
            fmlint JSON result dict.
        """
        lint_status = self._get("/api/lint/status")
        if lint_status.get("available"):
            with open(path, encoding="utf-8") as f:
                hr = f.read()
            return self._post("/api/lint", {"hr": hr, "path": path})

        # Local fallback
        import subprocess
        result = subprocess.run(
            ["python3", "-m", "agent.fmlint", "--format", "json", path],
            capture_output=True, text=True, cwd=str(_PROJECT_ROOT),
        )
        try:
            return json.loads(result.stdout)
        except ValueError:
            return {"error": result.stderr or "fmlint produced no output"}

    # ── DDL / schema ──────────────────────────────────────────────────────

    def ddl(self, sql: str) -> dict:
        """Execute a DDL statement via the ModifySchema script.

        Returns:
            Result dict with success/message/error.
        """
        r = self._post("/api/performscript", {
            "scriptName": "AGFM_Bridge",
            "parameter": {
                "command": "performScript",
                "scriptName": "ModifySchema",
                "parameter": sql,
            },
        })
        eval_id = r.get("id")
        if not eval_id:
            return {"success": False, "error": r.get("error", "No eval ID returned")}

        poll = self.poll_eval(eval_id, timeout=30)
        inner = poll.get("result", {})
        if isinstance(inner, dict):
            if inner.get("scriptError", -1) != 0 or inner.get("result", "0") != "0":
                return {"success": False, "error": f"ModifySchema error: {inner}"}
        return {"success": True, "message": f"DDL executed: {sql}"}


# ---------------------------------------------------------------------------
# Post-conversion XML patcher (carries over known plugin conversion bugs)
# ---------------------------------------------------------------------------

def _extract_js_params(hr_source: str) -> list:
    results = []
    for m in re.finditer(r'Perform JavaScript in Web Viewer\s*\[([^\]]+)\]', hr_source):
        body = m.group(1)
        params_match = re.search(r';\s*Parameters:\s*(.+)$', body.strip())
        if params_match:
            params = [p.strip() for p in re.split(r'\s*;\s*', params_match.group(1).strip())]
        else:
            params = []
        results.append(params)
    return results


def _patch_converted_xml(xml: str, hr_source: str | None = None) -> str:
    """Fix known HR→XML conversion bugs in the plugin's output."""
    xml = xml.replace("<WebViewerObjectName>", "<ObjectName>")
    xml = xml.replace("</WebViewerObjectName>", "</ObjectName>")

    if hr_source:
        js_params = _extract_js_params(hr_source)
        if js_params:
            step_iter = iter(js_params)
            def _inject(m):
                try:
                    params = next(step_iter)
                except StopIteration:
                    return m.group(0)
                step_xml = m.group(0)
                if not params or '<Parameters' in step_xml:
                    return step_xml
                params_xml = (
                    f'<Parameters Count="{len(params)}">'
                    + ''.join(f'<P><Calculation><![CDATA[{p}]]></Calculation></P>' for p in params)
                    + '</Parameters>'
                )
                return step_xml.replace('</Step>', params_xml + '</Step>')
            xml = re.sub(r'<Step[^>]*id="175"[^>]*>.*?</Step>', _inject, xml, flags=re.DOTALL)

    return xml


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_result(result: dict):
    if result.get("instructions"):
        print(result["instructions"])
    elif result.get("message"):
        print(result["message"])
    elif result.get("error"):
        print(f"Error: {result['error']}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(
        description="agentic-fm plugin bridge — primary interface to the AGFM plugin.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    # status
    sub.add_parser("status", help="Check plugin connectivity and show endpoint list")

    # context
    p_ctx = sub.add_parser("context", help="Fetch and sync context from the plugin")
    p_ctx.add_argument("--refresh", action="store_true", help="Force FM to re-snapshot first")
    p_ctx.add_argument("--no-sync", action="store_true", help="Print context but do not write CONTEXT.json")

    # query
    p_query = sub.add_parser("query", help="Run a FileMaker SQL query")
    p_query.add_argument("sql", help="SQL statement")
    p_query.add_argument("--timeout", type=int, default=30)

    # deploy
    p_deploy = sub.add_parser("deploy", help="Deploy a .fmscript or .xml to FileMaker")
    p_deploy.add_argument("path", help="Path to .fmscript or fmxmlsnippet .xml")
    p_deploy.add_argument("script_name", nargs="?", help="Target script name in FM")
    p_deploy.add_argument("--append", action="store_true", help="Append instead of replace")

    # bundle
    p_bundle = sub.add_parser("bundle", help="Bundle scripts into a clipboard paste")
    p_bundle.add_argument("files", nargs="+", help=".fmscript or .xml files to bundle")
    p_bundle.add_argument("--names", nargs="+", metavar="NAME", help="Script names (one per file)")

    # patch
    p_patch = sub.add_parser("patch", help="Apply surgical step edits to a script")
    p_patch.add_argument("patch_file", help="Path to JSON patch file")

    # convert
    p_conv = sub.add_parser("convert", help="Convert .fmscript to fmxmlsnippet XML")
    p_conv.add_argument("path", help="Path to .fmscript file")
    p_conv.add_argument("--out", metavar="FILE", help="Output path (default: stdout)")

    # lint
    p_lint = sub.add_parser("lint", help="Lint a .fmscript file")
    p_lint.add_argument("path", help="Path to .fmscript file")

    # clipboard-read
    sub.add_parser("clipboard-read", help="Read fmxmlsnippet XML from the FM clipboard")

    # clipboard-write
    p_cbw = sub.add_parser("clipboard-write", help="Write a file to the FM clipboard")
    p_cbw.add_argument("path", help="Path to fmxmlsnippet .xml file")

    # ddl
    p_ddl = sub.add_parser("ddl", help="Execute a DDL statement via ModifySchema")
    p_ddl.add_argument("sql", help="DDL statement")

    args = parser.parse_args()

    try:
        client = PluginClient.from_env()
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    # ── status ──
    if args.cmd == "status":
        available = client.is_available()
        print(f"Plugin: {'✓ available' if available else '✗ unavailable'} — {client.url}")
        if available:
            routes = client.discover()
            if isinstance(routes, list):
                print(f"Endpoints: {len(routes)} routes")
        sys.exit(0 if available else 1)

    # ── context ──
    elif args.cmd == "context":
        if args.no_sync:
            ctx = client.get_context(refresh=args.refresh)
        else:
            ctx = client.sync_context(refresh=args.refresh)
            print(f"CONTEXT.json updated — solution: {ctx.get('solution')}, "
                  f"layout: {ctx.get('current_layout', {}).get('name')}")
        if args.no_sync:
            print(json.dumps(ctx, indent=2))

    # ── query ──
    elif args.cmd == "query":
        result = client.query(args.sql, timeout=args.timeout)
        print(result)

    # ── deploy ──
    elif args.cmd == "deploy":
        mode = "append" if args.append else "replace"
        result = client.deploy(args.path, args.script_name, mode=mode)
        _print_result(result)
        sys.exit(0 if result.get("success") else 1)

    # ── bundle ──
    elif args.cmd == "bundle":
        result = client.bundle(args.files, args.names)
        _print_result(result)
        sys.exit(0 if result.get("success") else 1)

    # ── patch ──
    elif args.cmd == "patch":
        result = client.patch(args.patch_file)
        _print_result(result)
        sys.exit(0 if result.get("success") else 1)

    # ── convert ──
    elif args.cmd == "convert":
        with open(args.path, encoding="utf-8") as f:
            hr = f.read()
        xml = client.hr_to_xml(hr)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(xml)
            print(f"Written to {args.out}")
        else:
            print(xml)

    # ── lint ──
    elif args.cmd == "lint":
        result = client.lint(args.path)
        print(json.dumps(result, indent=2))
        files = result.get("files", [])
        errors = sum(f.get("error_count", 0) for f in files)
        sys.exit(0 if errors == 0 else 1)

    # ── clipboard-read ──
    elif args.cmd == "clipboard-read":
        xml = client.clipboard_read()
        print(xml)

    # ── clipboard-write ──
    elif args.cmd == "clipboard-write":
        with open(args.path, encoding="utf-8") as f:
            xml = f.read()
        client.clipboard_write(xml)
        print("Written to FM clipboard.")

    # ── ddl ──
    elif args.cmd == "ddl":
        result = client.ddl(args.sql)
        _print_result(result)
        sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
