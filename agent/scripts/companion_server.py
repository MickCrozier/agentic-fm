#!/usr/bin/env python3
"""
companion_server.py - Lightweight HTTP companion server for agentic-fm.

Lightweight HTTP companion server for shell command execution. FileMaker
calls this server via the native Insert from URL step (curl-compatible).

Usage:
    Start server:
        python agent/scripts/companion_server.py

    Start on custom port:
        python agent/scripts/companion_server.py --port 9000

    FileMaker calls it via Insert from URL:
        POST http://localhost:8765/explode
"""

import argparse
import json
import logging
import mimetypes
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_PORT = 8765
BIND_HOST = os.environ.get("COMPANION_BIND_HOST", "0.0.0.0")
REMOTE_VERSION_URL = "https://raw.githubusercontent.com/petrowsky/agentic-fm/main/version.txt"

# IP allowlist for Docker and localhost access
# Default: localhost + common Docker networks
ALLOWED_IPS = os.environ.get(
    "COMPANION_ALLOWED_IPS",
    "127.0.0.1,172.17.0.0/16,172.18.0.0/16,172.19.0.0/16,172.20.0.0/16,192.168.0.0/16"
).split(",")

def _ip_in_range(ip: str, cidr: str) -> bool:
    """Check if an IP is within a CIDR range."""
    try:
        import ipaddress
        ip_obj = ipaddress.ip_address(ip)
        network = ipaddress.ip_network(cidr, strict=False)
        return ip_obj in network
    except (ValueError, AttributeError):
        return False

def _is_allowed_ip(ip: str) -> bool:
    """Check if the source IP is in the allowlist."""
    for allowed in ALLOWED_IPS:
        allowed = allowed.strip()
        if "/" in allowed:
            # CIDR range
            if _ip_in_range(ip, allowed):
                return True
        else:
            # Single IP
            if ip == allowed:
                return True
    return False

# Read version from version.txt at the repo root
def _read_local_version() -> str:
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        version_file = os.path.join(here, "..", "..", "version.txt")
        with open(version_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "unknown"

VERSION = _read_local_version()

# ---------------------------------------------------------------------------
# Webviewer process state (module-level, shared across request threads)
# ---------------------------------------------------------------------------

_webviewer_proc: "subprocess.Popen | None" = None
_webviewer_lock = threading.Lock()

# Pending paste job — set by /trigger before firing AppleScript,
# consumed by Agentic-fm Paste via GET /pending.
# Shape: {"target": str, "auto_save": bool}
_pending_job: dict = {}
_pending_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("companion_server")
SUBPROCESS_HEARTBEAT_SECONDS = 5


def _stream_pipe(pipe, level, prefix, output_buffer, state):
    """Copy a subprocess pipe to the logger in real time while buffering it."""
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            output_buffer.append(line)
            with state["lock"]:
                state["last_output_at"] = time.monotonic()
            level("%s%s", prefix, line.rstrip("\n"))
    finally:
        pipe.close()


def _run_command_streaming(cmd, *, cwd, env, label):
    """Run a command, stream its output to the server log, and capture it."""
    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )

    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []
    state = {"last_output_at": time.monotonic(), "lock": threading.Lock()}

    stdout_thread = threading.Thread(
        target=_stream_pipe,
        args=(process.stdout, log.info, f"[{label} stdout] ", stdout_chunks, state),
        daemon=True,
    )
    stderr_thread = threading.Thread(
        target=_stream_pipe,
        args=(process.stderr, log.warning, f"[{label} stderr] ", stderr_chunks, state),
        daemon=True,
    )

    stdout_thread.start()
    stderr_thread.start()

    last_heartbeat_at = time.monotonic()
    while True:
        try:
            return_code = process.wait(timeout=1)
            break
        except subprocess.TimeoutExpired:
            now = time.monotonic()
            with state["lock"]:
                silence_for = now - state["last_output_at"]
            if (
                silence_for >= SUBPROCESS_HEARTBEAT_SECONDS
                and now - last_heartbeat_at >= SUBPROCESS_HEARTBEAT_SECONDS
            ):
                log.info(
                    "%s still running... (%ds since last output)",
                    label,
                    int(silence_for),
                )
                last_heartbeat_at = now

    stdout_thread.join()
    stderr_thread.join()

    return {
        "returncode": return_code,
        "stdout": "".join(stdout_chunks),
        "stderr": "".join(stderr_chunks),
    }


# ---------------------------------------------------------------------------
# Threading HTTP server (handles concurrent requests)
# ---------------------------------------------------------------------------

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    """HTTPServer with thread-per-request concurrency."""
    daemon_threads = True


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------

class CompanionHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        """Route access log through the standard logger."""
        log.info("%s - %s", self.address_string(), fmt % args)

    def _check_ip_allowed(self) -> bool:
        """Check if the request source IP is allowed. Return False and send 403 if not."""
        client_ip = self.client_address[0]
        if not _is_allowed_ip(client_ip):
            log.warning("Rejected request from unauthorized IP: %s", client_ip)
            self._send_json({"error": "Forbidden"}, status=403)
            return False
        return True

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    def do_GET(self):
        if not self._check_ip_allowed():
            return

        if self.path == "/health":
            self._handle_health()
        elif self.path == "/pending":
            self._handle_pending_get()
        elif self.path == "/webviewer/status":
            self._handle_webviewer_status()
        elif self.path == "/clipboard":
            self._handle_clipboard_read()
        elif self.path == "/context":
            self._handle_context_read()
        elif self.path == "/layout":
            self._handle_layout_read()
        elif self.path == "/fields":
            self._handle_fields_read()
        elif self.path.startswith("/preview/"):
            layout_name = self.path[len("/preview/"):]
            self._handle_preview_get(layout_name)
        elif self.path.startswith("/sandbox/"):
            self._handle_sandbox_file(self.path[len("/sandbox/"):])
        else:
            self._send_json({"error": "Not found"}, status=404)

    def do_POST(self):
        if not self._check_ip_allowed():
            return

        if self.path == "/explode":
            self._handle_explode()
        elif self.path == "/context":
            self._handle_context()
        elif self.path == "/debug":
            self._handle_debug()
        elif self.path == "/clipboard":
            self._handle_clipboard()
        elif self.path == "/trigger":
            self._handle_trigger()
        elif self.path == "/pending":
            self._handle_pending_post()
        elif self.path == "/webviewer/start":
            self._handle_webviewer_start()
        elif self.path == "/webviewer/stop":
            self._handle_webviewer_stop()
        elif self.path == "/webviewer/push":
            self._handle_webviewer_push()
        elif self.path == "/lint":
            self._handle_lint()
        elif self.path.startswith("/preview/"):
            layout_name = self.path[len("/preview/"):]
            self._handle_preview_post(layout_name)
        else:
            self._send_json({"error": "Not found"}, status=404)

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    def _handle_health(self):
        self._send_json({"status": "ok", "version": VERSION})

    def _handle_explode(self):
        # Read and parse request body
        try:
            body = self._read_body()
            payload = json.loads(body)
        except (ValueError, OSError) as exc:
            self._send_json(
                {"success": False, "exit_code": -1, "error": f"Invalid request: {exc}"},
                status=400,
            )
            return

        # Validate required fields
        missing = [
            f for f in ("solution_name", "export_file_path", "repo_path")
            if not payload.get(f)
        ]
        if missing:
            self._send_json(
                {
                    "success": False,
                    "exit_code": -1,
                    "error": f"Missing required fields: {', '.join(missing)}",
                },
                status=400,
            )
            return

        solution_name = payload["solution_name"]
        export_file_path = payload["export_file_path"]
        repo_path = payload["repo_path"]
        exploder_bin_path = payload.get("exploder_bin_path", "")

        # Expand ~ in paths
        repo_path = os.path.expanduser(repo_path)
        export_file_path = os.path.expanduser(export_file_path)

        # Build environment for subprocess
        env = os.environ.copy()
        if exploder_bin_path:
            env["FM_XML_EXPLODER_BIN"] = os.path.expanduser(exploder_bin_path)

        # Build command: {repo_path}/fmparse.sh -s "{solution_name}" "{export_file_path}"
        fmparse = os.path.join(repo_path, "fmparse.sh")
        cmd = [fmparse, "-s", solution_name, export_file_path]

        log.info(
            "Running fmparse.sh: solution=%r export=%r cwd=%r",
            solution_name,
            export_file_path,
            repo_path,
        )

        try:
            result = _run_command_streaming(
                cmd,
                cwd=repo_path,
                env=env,
                label="fmparse.sh",
            )

            success = result["returncode"] == 0
            response = {
                "success": success,
                "exit_code": result["returncode"],
                "stdout": result["stdout"],
                "stderr": result["stderr"],
            }
            status = 200 if success else 500

            log.info(
                "fmparse.sh exited with code %d", result["returncode"]
            )

        except Exception as exc:
            log.exception("Exception running fmparse.sh: %s", exc)
            response = {
                "success": False,
                "exit_code": -1,
                "error": str(exc),
            }
            status = 500

        self._send_json(response, status=status)

    def _handle_context_read(self):
        """Return the current CONTEXT.json content."""
        here = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.join(here, "..", "..")
        context_path = os.path.join(repo_root, "agent", "CONTEXT.json")
        if not os.path.isfile(context_path):
            self._send_json({"error": "No CONTEXT.json found"}, status=404)
            return
        try:
            with open(context_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._send_json(data)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=500)

    def _handle_layout_read(self):
        """Return the layout XML for the current layout from CONTEXT.json."""
        here = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.join(here, "..", "..")
        context_path = os.path.join(repo_root, "agent", "CONTEXT.json")

        if not os.path.isfile(context_path):
            self._send_json({"error": "No CONTEXT.json found"}, status=404)
            return

        try:
            with open(context_path, "r", encoding="utf-8") as f:
                ctx = json.load(f)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=500)
            return

        solution = ctx.get("solution", "")
        layout = ctx.get("current_layout", {})
        layout_id = layout.get("id")

        if not solution or not layout_id:
            self._send_json({"error": "CONTEXT.json missing solution or current_layout.id"}, status=404)
            return

        layouts_root = os.path.join(repo_root, "agent", "xml_parsed", "layouts", solution)
        if not os.path.isdir(layouts_root):
            self._send_json({"error": f"No layouts directory for solution '{solution}'"}, status=404)
            return

        # Walk recursively to find "... - ID {layout_id}.xml"
        suffix = f"- ID {layout_id}.xml"
        found = None
        for dirpath, _dirs, files in os.walk(layouts_root):
            for fname in files:
                if fname.endswith(suffix):
                    found = os.path.join(dirpath, fname)
                    break
            if found:
                break

        if not found:
            self._send_json({"error": f"Layout ID {layout_id} not found in {solution}"}, status=404)
            return

        try:
            with open(found, "r", encoding="utf-8") as f:
                xml = f.read()
            body = xml.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/xml; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=500)

    def _handle_fields_read(self):
        """Return a structured list of fields grouped by TO from CONTEXT.json,
        falling back to fields.index if CONTEXT.json is absent.

        CONTEXT.json tables is a dict keyed by TO name; fields within each table
        is also a dict keyed by field name. Separator entries (names containing
        '---') are skipped. The dict already contains only TOs relevant to the
        current layout (base TO + related TOs), so all keys are shown directly.
        """
        here = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.join(here, "..", "..")
        context_path = os.path.join(repo_root, "agent", "CONTEXT.json")

        tables = []

        # Primary: CONTEXT.json
        if os.path.isfile(context_path):
            try:
                with open(context_path, "r", encoding="utf-8") as f:
                    ctx = json.load(f)
                tables_dict = ctx.get("tables", {})
                base_to = ctx.get("current_layout", {}).get("base_to", "")
                # Put base TO first, then remaining TOs in sorted order
                to_names = list(tables_dict.keys())
                if base_to in to_names:
                    to_names = [base_to] + sorted(n for n in to_names if n != base_to)
                else:
                    to_names = sorted(to_names)
                for to_name in to_names:
                    to_data = tables_dict[to_name]
                    fields_dict = to_data.get("fields", {})
                    fields = []
                    for field_name, field_data in fields_dict.items():
                        # Skip separator entries like "--- CONTACT FIELDS ---"
                        if "---" in field_name:
                            continue
                        if isinstance(field_data, dict):
                            fid = field_data.get("id", 0)
                            ftype = field_data.get("type", "")
                        else:
                            fid = 0
                            ftype = ""
                        fields.append({
                            "name": field_name,
                            "id":   fid,
                            "type": ftype,
                            "ref":  f"{to_name}::{field_name}",
                        })
                    if fields:
                        tables.append({"table": to_name, "fields": fields})
                if tables:
                    self._send_json({"source": "context", "tables": tables})
                    return
            except Exception as exc:
                log.warning("Could not parse CONTEXT.json for fields: %s", exc)

        # Fallback: fields.index scoped to the solution named in CONTEXT.json
        context_dir = os.path.join(repo_root, "agent", "context")
        index_file = None
        solution_name = None
        if os.path.isfile(context_path):
            try:
                with open(context_path, "r", encoding="utf-8") as f:
                    solution_name = json.load(f).get("solution")
            except Exception:
                pass
        if solution_name:
            candidate = os.path.join(context_dir, solution_name, "fields.index")
            if os.path.isfile(candidate):
                index_file = candidate
        if not index_file and os.path.isdir(context_dir):
            # Last resort: first solution folder found
            for entry in os.scandir(context_dir):
                candidate = os.path.join(context_dir, entry.name, "fields.index")
                if os.path.isfile(candidate):
                    index_file = candidate
                    break

        if index_file:
            try:
                by_table = {}
                with open(index_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        parts = line.split("|")
                        if len(parts) < 3:
                            continue
                        # Format: TableName|TableID|FieldName|FieldID|DataType|FieldType|...
                        tbl  = parts[0]
                        name = parts[2] if len(parts) > 2 else ""
                        fid  = parts[3] if len(parts) > 3 else "0"
                        ftype = parts[4] if len(parts) > 4 else ""
                        by_table.setdefault(tbl, []).append({
                            "name": name,
                            "id":   fid,
                            "type": ftype,
                            "ref":  f"{tbl}::{name}",
                        })
                for tbl, fields in sorted(by_table.items()):
                    tables.append({"table": tbl, "fields": fields})
                self._send_json({"source": "index", "tables": tables})
                return
            except Exception as exc:
                log.warning("Could not parse fields.index: %s", exc)

        self._send_json({"source": "none", "tables": []})

    def _handle_context(self):
        try:
            body = self._read_body()
            payload = json.loads(body)
        except (ValueError, OSError) as exc:
            self._send_json({"success": False, "error": f"Invalid request: {exc}"}, status=400)
            return

        missing = [f for f in ("repo_path", "context") if not payload.get(f)]
        if missing:
            self._send_json(
                {"success": False, "error": f"Missing required fields: {', '.join(missing)}"},
                status=400,
            )
            return

        repo_path = os.path.expanduser(payload["repo_path"])
        context = payload["context"]

        # Accept context as a pre-serialised string or a parsed object
        if isinstance(context, str):
            try:
                json.loads(context)  # validate only
            except ValueError as exc:
                self._send_json({"success": False, "error": f"Invalid context JSON: {exc}"}, status=400)
                return
            context_str = context
        else:
            context_str = json.dumps(context, indent=2, ensure_ascii=False)

        output_path = os.path.join(repo_path, "agent", "CONTEXT.json")

        # Check context_version and warn if outdated
        CONTEXT_VERSION_CURRENT = 2
        try:
            ctx_data = json.loads(context_str) if isinstance(context_str, str) else context
            ctx_version = ctx_data.get("context_version")
            if ctx_version is None or ctx_version < CONTEXT_VERSION_CURRENT:
                log.warning(
                    "CONTEXT.json has context_version=%s (current is %s). "
                    "Update the Context() custom function in your solution.",
                    ctx_version, CONTEXT_VERSION_CURRENT,
                )
        except (ValueError, TypeError, AttributeError):
            pass

        try:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(context_str)
            log.info("CONTEXT.json written to %s", output_path)
            self._send_json({"success": True, "path": output_path})
        except Exception as exc:
            log.exception("Failed to write CONTEXT.json: %s", exc)
            self._send_json({"success": False, "error": str(exc)}, status=500)

    def _handle_pending_get(self):
        """Return and clear the pending paste job."""
        global _pending_job
        with _pending_lock:
            job = _pending_job.copy()
            _pending_job = {}
        self._send_json(job)

    def _handle_pending_post(self):
        """Set the pending paste job."""
        global _pending_job
        try:
            body = self._read_body()
            payload = json.loads(body)
        except (ValueError, OSError) as exc:
            self._send_json({"success": False, "error": f"Invalid request: {exc}"}, status=400)
            return
        target = payload.get("target", "")
        auto_save = bool(payload.get("auto_save", False))
        select_all = bool(payload.get("select_all", True))
        with _pending_lock:
            _pending_job = {"target": target, "auto_save": auto_save, "select_all": select_all}
        log.info("Pending job set: target=%r auto_save=%s select_all=%s", target, auto_save, select_all)
        self._send_json({"success": True})

    def _handle_trigger(self):
        """
        Trigger FM Pro to perform a named script via osascript.

        Payload: { "fm_app_name": "FileMaker Pro — ...", "script": "name", "parameter": "..." }
        Returns: { "success": bool, "stdout": str, "stderr": str }
        """
        try:
            body = self._read_body()
            payload = json.loads(body)
        except (ValueError, OSError) as exc:
            self._send_json({"success": False, "error": f"Invalid request: {exc}"}, status=400)
            return

        fm_app = payload.get("fm_app_name", "FileMaker Pro")
        script = payload.get("script", "")
        parameter = payload.get("parameter", "")
        target_file = payload.get("target_file", "")

        def as_str(s):
            """Escape double-quotes for use inside an AppleScript double-quoted string."""
            return s.replace("\\", "\\\\").replace('"', '\\"')

        # raw_applescript bypasses the FM do script path — no script name required
        raw = payload.get("raw_applescript", "")
        if raw:
            applescript = raw
        elif not script:
            self._send_json({"success": False, "error": "Missing required field: script"}, status=400)
            return
        else:
            # Store the target and auto_save flag in the pending slot so the
            # FM script can retrieve them via GET /pending (AppleScript parameter
            # passing via "given parameter:" is unreliable in FM Pro 22).
            if parameter:
                global _pending_job
                auto_save = bool(payload.get("auto_save", False))
                select_all = bool(payload.get("select_all", True))
                with _pending_lock:
                    _pending_job = {"target": parameter, "auto_save": auto_save, "select_all": select_all}
                log.info("Pending job set: target=%r auto_save=%s select_all=%s", parameter, auto_save, select_all)

            # When target_file is provided, address the specific FM document
            # by name instead of positional document 1. This ensures the
            # correct file is targeted when multiple files are open.
            if target_file:
                doc_clause = f'tell (first document whose name contains "{as_str(target_file)}")'
                log.info("Trigger: targeting document %r", target_file)
            else:
                doc_clause = "tell document 1"
                log.info("Trigger: no target_file — using document 1")

            applescript = (
                f'tell application "{as_str(fm_app)}"\n'
                f'    activate\n'
                f'    {doc_clause}\n'
                f'        do script "{as_str(script)}"\n'
                f'    end tell\n'
                f'end tell'
            )

        try:
            result = subprocess.run(
                ["osascript", "-e", applescript],
                capture_output=True, text=True, timeout=30
            )
            success = result.returncode == 0
            if success:
                log.info("Trigger: ran '%s' in %s", script, fm_app)
            else:
                log.error("Trigger failed: %s", result.stderr)
            self._send_json({
                "success": success,
                "stdout": result.stdout.strip(),
                "stderr": result.stderr.strip(),
            })
        except subprocess.TimeoutExpired:
            self._send_json({"success": False, "error": "osascript timed out after 30s"}, status=500)
        except FileNotFoundError:
            self._send_json({"success": False, "error": "osascript not found — is this macOS?"}, status=500)
        except Exception as exc:
            log.exception("Trigger handler error: %s", exc)
            self._send_json({"success": False, "error": str(exc)}, status=500)

    def _handle_clipboard_read(self):
        """Read FM objects from the macOS clipboard and return as XML."""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        clipboard_py = os.path.join(script_dir, "clipboard.py")

        try:
            result = subprocess.run(
                ["python3", clipboard_py, "read"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0 and result.stdout.strip():
                log.info("Clipboard read succeeded")
                self._send_json({"success": True, "xml": result.stdout})
            else:
                error = result.stderr.strip() or "No FileMaker objects on clipboard"
                log.warning("Clipboard read failed: %s", error)
                self._send_json(
                    {"success": False, "error": error},
                    status=404 if "No FileMaker" in error else 500,
                )
        except subprocess.TimeoutExpired:
            self._send_json(
                {"success": False, "error": "Clipboard read timed out"},
                status=500,
            )
        except Exception as exc:
            log.exception("Clipboard read error: %s", exc)
            self._send_json({"success": False, "error": str(exc)}, status=500)

    def _handle_clipboard(self):
        """Accept XML content and write it to the macOS clipboard via clipboard.py."""
        try:
            body = self._read_body()
            payload = json.loads(body)
        except (ValueError, OSError) as exc:
            self._send_json({"success": False, "error": f"Invalid request: {exc}"}, status=400)
            return

        xml = payload.get("xml", "")
        if not xml:
            self._send_json({"success": False, "error": "Missing required field: xml"}, status=400)
            return

        cls = payload.get("class")  # optional FM class override, e.g. "XMSS"

        import tempfile
        script_dir = os.path.dirname(os.path.abspath(__file__))
        clipboard_py = os.path.join(script_dir, "clipboard.py")

        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".xml", encoding="utf-8", delete=False
            ) as tmp:
                tmp.write(xml)
                tmp_path = tmp.name

            cmd = ["python3", clipboard_py, "write", tmp_path]
            if cls:
                cmd += ["--class", cls]
            result = subprocess.run(cmd, capture_output=True, text=True)
            os.unlink(tmp_path)

            if result.returncode == 0:
                log.info("Clipboard write succeeded")
                self._send_json({"success": True})
            else:
                log.error("Clipboard write failed: %s", result.stderr)
                self._send_json(
                    {"success": False, "error": result.stderr or "clipboard.py returned non-zero"},
                    status=500,
                )
        except Exception as exc:
            log.exception("Clipboard handler error: %s", exc)
            self._send_json({"success": False, "error": str(exc)}, status=500)

    def _handle_debug(self):
        try:
            body = self._read_body()
            payload = json.loads(body)
        except (ValueError, OSError) as exc:
            self._send_json({"success": False, "error": f"Invalid request: {exc}"}, status=400)
            return

        # Resolve repo root from script location
        script_dir = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.dirname(os.path.dirname(script_dir))
        debug_dir = os.path.join(repo_root, "agent", "debug")
        os.makedirs(debug_dir, exist_ok=True)
        output_path = os.path.join(debug_dir, "output.json")

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)

        log.info("Debug output written to %s", output_path)
        self._send_json({"success": True, "path": output_path})

    def _handle_webviewer_status(self):
        global _webviewer_proc
        with _webviewer_lock:
            running = _webviewer_proc is not None and _webviewer_proc.poll() is None
        self._send_json({"running": running})

    def _handle_webviewer_start(self):
        global _webviewer_proc
        try:
            body = self._read_body()
            payload = json.loads(body) if body else {}
        except (ValueError, OSError) as exc:
            self._send_json({"success": False, "error": f"Invalid request: {exc}"}, status=400)
            return

        repo_path = payload.get("repo_path", "")
        if not repo_path:
            self._send_json({"success": False, "error": "Missing required field: repo_path"}, status=400)
            return

        repo_path = os.path.expanduser(repo_path)
        webviewer_path = os.path.join(repo_path, "webviewer")

        with _webviewer_lock:
            if _webviewer_proc is not None and _webviewer_proc.poll() is None:
                self._send_json({"success": True, "status": "already_running"})
                return

            try:
                proc = subprocess.Popen(
                    ["npm", "run", "dev"],
                    cwd=webviewer_path,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                _webviewer_proc = proc
                log.info("Started webviewer (pid=%d) in %s", proc.pid, webviewer_path)
                self._send_json({"success": True, "status": "started", "pid": proc.pid})
            except Exception as exc:
                log.exception("Failed to start webviewer: %s", exc)
                self._send_json({"success": False, "error": str(exc)}, status=500)

    def _handle_webviewer_stop(self):
        global _webviewer_proc
        with _webviewer_lock:
            if _webviewer_proc is None or _webviewer_proc.poll() is not None:
                self._send_json({"success": True, "status": "not_running"})
                return

            try:
                pgid = os.getpgid(_webviewer_proc.pid)
                os.killpg(pgid, signal.SIGTERM)
                _webviewer_proc = None
                log.info("Stopped webviewer (process group %d)", pgid)
                self._send_json({"success": True, "status": "stopped"})
            except Exception as exc:
                log.exception("Failed to stop webviewer: %s", exc)
                self._send_json({"success": False, "error": str(exc)}, status=500)

    def _handle_webviewer_push(self):
        """
        Write an agent output payload for the webviewer to pick up via polling.

        Payload: { "type": "preview"|"diff"|"result"|"diagram"|"layout-preview", "content": "...", "before": "...", "styles": "...", "repo_path": "..." }
        Returns: { "success": bool }
        """
        try:
            body = self._read_body()
            payload = json.loads(body)
        except (ValueError, OSError) as exc:
            self._send_json({"success": False, "error": f"Invalid request: {exc}"}, status=400)
            return

        payload_type = payload.get("type", "")
        if payload_type not in ("preview", "diff", "result", "diagram", "layout-preview"):
            self._send_json({"success": False, "error": f"Unknown type: {payload_type!r}. Must be preview, diff, result, diagram, or layout-preview."}, status=400)
            return

        repo_path = payload.get("repo_path", "")
        if not repo_path:
            self._send_json({"success": False, "error": "Missing required field: repo_path"}, status=400)
            return

        repo_path = os.path.expanduser(repo_path)
        output_path = os.path.join(repo_path, "agent", "config", ".agent-output.json")

        import time
        output = {
            "type": payload_type,
            "content": payload.get("content", ""),
            "before": payload.get("before", ""),
            "timestamp": time.time(),
        }
        # Include optional styles field for layout-preview payloads
        if payload.get("styles"):
            output["styles"] = payload["styles"]

        try:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(output, f, ensure_ascii=False, indent=2)
            log.info("Agent output written to %s (type=%s)", output_path, payload_type)
            self._send_json({"success": True, "path": output_path})
        except Exception as exc:
            log.exception("Failed to write agent output: %s", exc)
            self._send_json({"success": False, "error": str(exc)}, status=500)

    def _handle_preview_get(self, layout_name: str):
        """
        Serve a layout HTML preview.

        GET /preview/<layout_name>
        Returns: text/html — the preview file, a fallback from .agent-output.json,
                 or a placeholder message.
        """
        here = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.dirname(os.path.dirname(here))

        # Look for agent/sandbox/{layout_name}_web.html
        html_path = os.path.join(repo_root, "agent", "sandbox", f"{layout_name}_web.html")
        if os.path.isfile(html_path):
            try:
                with open(html_path, "r", encoding="utf-8") as f:
                    content = f.read()
                self._send_html(content)
                return
            except OSError as exc:
                log.warning("Could not read preview file %s: %s", html_path, exc)

        # Fall back to agent/config/.agent-output.json
        output_json_path = os.path.join(repo_root, "agent", "config", ".agent-output.json")
        if os.path.isfile(output_json_path):
            try:
                with open(output_json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                content = data.get("content", "")
                if content:
                    self._send_html(content)
                    return
            except (OSError, json.JSONDecodeError) as exc:
                log.warning("Could not read .agent-output.json: %s", exc)

        # Placeholder
        self._send_html(f"<h2>No preview available for {layout_name}</h2>")

    def _handle_preview_post(self, layout_name: str):
        """
        Store a layout HTML preview.

        POST /preview/<layout_name>
        Body: { "html": "...", "solution": "..." }
        Returns: { "success": true, "path": "agent/sandbox/{layout_name}_web.html" }
        """
        try:
            body = self._read_body()
            payload = json.loads(body)
        except (ValueError, OSError) as exc:
            self._send_json({"success": False, "error": f"Invalid request: {exc}"}, status=400)
            return

        html = payload.get("html", "")
        if not html:
            self._send_json({"success": False, "error": "Missing required field: html"}, status=400)
            return

        here = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.dirname(os.path.dirname(here))
        sandbox_dir = os.path.join(repo_root, "agent", "sandbox")
        out_path = os.path.join(sandbox_dir, f"{layout_name}_web.html")
        rel_path = f"agent/sandbox/{layout_name}_web.html"

        try:
            os.makedirs(sandbox_dir, exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(html)
            log.info("Preview written to %s", out_path)
            self._send_json({"success": True, "path": rel_path})
        except Exception as exc:
            log.exception("Failed to write preview: %s", exc)
            self._send_json({"success": False, "error": str(exc)}, status=500)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _handle_lint(self):
        """Lint FileMaker code via FMLint engine.

        POST /lint
        Body: { "content": "...", "format": "xml"|"hr"|null, "tier": 1|2|3|null,
                "disable": ["N003", ...] }
        Returns: LintResult as JSON
        """
        try:
            body = json.loads(self._read_body())
        except (json.JSONDecodeError, ValueError):
            self._send_json({"error": "Invalid JSON body"}, status=400)
            return

        content = body.get("content", "")
        if not content:
            self._send_json({"error": "Missing 'content' field"}, status=400)
            return

        fmt = body.get("format")
        tier = body.get("tier")
        disabled = body.get("disable", [])

        try:
            # Resolve project root from this script's location
            here = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.join(here, "..", "..")

            sys.path.insert(0, project_root)
            from agent.fmlint import lint

            config = {}
            if disabled:
                config["disable"] = disabled
            if tier is not None:
                config["max_tier"] = tier

            result = lint(
                content,
                fmt=fmt,
                project_root=project_root,
                config=config,
            )
            self._send_json(result.to_dict())
        except Exception as e:
            logging.exception("FMLint error")
            self._send_json({"error": str(e)}, status=500)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length > 0 else b""

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_sandbox_file(self, filename: str):
        # Prevent path traversal
        if ".." in filename or filename.startswith("/"):
            self._send_json({"error": "Forbidden"}, status=403)
            return
        here = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.dirname(os.path.dirname(here))
        file_path = os.path.join(repo_root, "agent", "sandbox", filename)
        if not os.path.isfile(file_path):
            self._send_json({"error": f"Not found: {filename}"}, status=404)
            return
        mime, _ = mimetypes.guess_type(file_path)
        mime = mime or "application/octet-stream"
        with open(file_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, content: str, status: int = 200):
        body = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _check_for_updates():
    """Fetch the remote version.txt and warn if a newer version is available."""
    try:
        with urllib.request.urlopen(REMOTE_VERSION_URL, timeout=5) as resp:
            remote = resp.read().decode("utf-8").strip()
        if remote and remote != VERSION:
            local_parts = tuple(int(x) for x in VERSION.split(".") if x.isdigit())
            remote_parts = tuple(int(x) for x in remote.split(".") if x.isdigit())
            if remote_parts > local_parts:
                log.warning(
                    "A new version is available: v%s (you have v%s). "
                    "Run 'git pull --ff-only' in your agentic-fm folder to update, "
                    "then restart the server. See UPDATES.md for details.",
                    remote,
                    VERSION,
                )
    except Exception:
        pass  # No network, rate-limited, etc. — fail silently


def parse_args():
    parser = argparse.ArgumentParser(
        description="agentic-fm companion server — exposes fmparse.sh over HTTP for FileMaker.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    port = args.port

    server = ThreadingHTTPServer((BIND_HOST, port), CompanionHandler)

    log.info("companion_server v%s listening on %s:%d", VERSION, BIND_HOST, port)
    threading.Thread(target=_check_for_updates, daemon=True).start()
    log.info("Endpoints: GET /health  GET /clipboard  GET /context  GET /layout  GET /fields  GET /webviewer/status  GET /preview/<name>  GET /sandbox/<file>  POST /explode  POST /context  POST /clipboard  POST /trigger  POST /debug  POST /webviewer/start  POST /webviewer/stop  POST /webviewer/push  POST /preview/<name>")
    log.info("Press Ctrl-C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down.")
        server.server_close()
        with _webviewer_lock:
            if _webviewer_proc is not None and _webviewer_proc.poll() is None:
                try:
                    pgid = os.getpgid(_webviewer_proc.pid)
                    os.killpg(pgid, signal.SIGTERM)
                    log.info("Stopped webviewer (process group %d)", pgid)
                except Exception as exc:
                    log.warning("Failed to stop webviewer on shutdown: %s", exc)


if __name__ == "__main__":
    main()
