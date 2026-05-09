#!/usr/bin/env bash
# Runs every time the dev container starts.

CLIPBOARD_SERVER_URL="${CLIPBOARD_SERVER_URL:-http://host.docker.internal:8766}"

# ---------------------------------------------------------------------------
# Start companion server in the background
# ---------------------------------------------------------------------------
echo "Starting companion server..."
python3 agent/scripts/companion_server.py > /tmp/companion_server.log 2>&1 &
echo "  Companion server started (log: /tmp/companion_server.log)"

# ---------------------------------------------------------------------------
# Start webviewer and layout editor
# ---------------------------------------------------------------------------
echo "Starting webviewer..."
npm run dev --prefix webviewer > /tmp/webviewer.log 2>&1 &
echo "  Webviewer started on :8080 (log: /tmp/webviewer.log)"

echo "Starting layout editor..."
npm run dev --prefix layout-editor-app > /tmp/layout_editor.log 2>&1 &
echo "  Layout editor started on :8081 (log: /tmp/layout_editor.log)"

# ---------------------------------------------------------------------------
# Check host clipboard server
# ---------------------------------------------------------------------------
echo "Checking host clipboard server at $CLIPBOARD_SERVER_URL..."
if curl -sf --max-time 3 "$CLIPBOARD_SERVER_URL/health" > /dev/null 2>&1; then
    echo "  ✓ Host clipboard server is reachable"
else
    echo ""
    echo "  ⚠  Host clipboard server not reachable at $CLIPBOARD_SERVER_URL"
    echo "     Start it on your Mac with:"
    echo "       python3 agent/scripts/host_clipboard_server.py"
    echo ""
fi
