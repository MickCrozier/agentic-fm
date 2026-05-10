#!/usr/bin/env python3
"""
host_clipboard_server.py - Clipboard-only HTTP server for the macOS host.

Runs on the host machine and exposes the macOS clipboard over HTTP so that
the companion server inside a dev container can read and write FileMaker
clipboard objects via host.docker.internal:<port>.

Usage:
    python3 agent/scripts/host_clipboard_server.py
    python3 agent/scripts/host_clipboard_server.py --port 9000
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

DEFAULT_PORT = 8766
BIND_HOST = "0.0.0.0"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("host_clipboard_server")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CLIPBOARD_PY = os.path.join(SCRIPT_DIR, "clipboard.py")


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class ClipboardHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"status": "ok"})
        elif self.path == "/clipboard":
            self._handle_clipboard_read()
        else:
            self._send_json({"error": "Not found"}, status=404)

    def do_POST(self):
        if self.path == "/clipboard":
            self._handle_clipboard_write()
        else:
            self._send_json({"error": "Not found"}, status=404)

    def _handle_clipboard_read(self):
        try:
            result = subprocess.run(
                ["python3", CLIPBOARD_PY, "read"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0 and result.stdout.strip():
                log.info("Clipboard read succeeded")
                self._send_json({"success": True, "xml": result.stdout})
            else:
                error = result.stderr.strip() or "No FileMaker objects on clipboard"
                log.warning("Clipboard read failed: %s", error)
                self._send_json({"success": False, "error": error}, status=404)
        except subprocess.TimeoutExpired:
            self._send_json({"success": False, "error": "Clipboard read timed out"}, status=500)
        except Exception as exc:
            log.exception("Clipboard read error: %s", exc)
            self._send_json({"success": False, "error": str(exc)}, status=500)

    def _handle_clipboard_write(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length > 0 else b""
            payload = json.loads(body)
        except (ValueError, OSError) as exc:
            self._send_json({"success": False, "error": f"Invalid request: {exc}"}, status=400)
            return

        xml = payload.get("xml", "")
        if not xml:
            self._send_json({"success": False, "error": "Missing required field: xml"}, status=400)
            return

        cls = payload.get("class")

        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".xml", encoding="utf-8", delete=False
            ) as tmp:
                tmp.write(xml)
                tmp_path = tmp.name

            cmd = ["python3", CLIPBOARD_PY, "write", tmp_path]
            if cls:
                cmd += ["--class", cls]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
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
        except subprocess.TimeoutExpired:
            self._send_json({"success": False, "error": "Clipboard write timed out"}, status=500)
        except Exception as exc:
            log.exception("Clipboard write error: %s", exc)
            self._send_json({"success": False, "error": str(exc)}, status=500)

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def parse_args():
    parser = argparse.ArgumentParser(description="agentic-fm host clipboard server.")
    parser.add_argument(
        "--port", type=int, default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    server = ThreadingHTTPServer((BIND_HOST, args.port), ClipboardHandler)
    log.info("host_clipboard_server listening on %s:%d", BIND_HOST, args.port)
    log.info("Endpoints: GET /health  GET /clipboard  POST /clipboard")
    log.info("Press Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
