#!/usr/bin/env bash
# Runs every time the dev container starts.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------------------------------------------------------------------------
# Start webviewer and layout editor
# ---------------------------------------------------------------------------
echo "Starting webviewer..."
setsid bash -c "npm run dev --prefix '$REPO_ROOT/webviewer' > /tmp/webviewer.log 2>&1" &
echo "  Webviewer started on :8080 (log: /tmp/webviewer.log)"

echo "Starting layout editor..."
setsid bash -c "npm run dev --prefix '$REPO_ROOT/layout-editor-app' > /tmp/layout_editor.log 2>&1" &
echo "  Layout editor started on :8081 (log: /tmp/layout_editor.log)"

# ---------------------------------------------------------------------------
# Check the agentic-fm plugin on the macOS host
# ---------------------------------------------------------------------------
echo "Checking agentic-fm plugin..."
if python3 "$REPO_ROOT/agent/scripts/agfm_bridge.py" status > /dev/null 2>&1; then
    echo "  ✓ Plugin is reachable"
else
    echo ""
    echo "  ⚠  agentic-fm plugin not reachable"
    echo "     The plugin is the only path to FileMaker — nothing FM-related will work without it."
    echo ""
    echo "     1. Make sure the plugin is running on your Mac"
    echo "     2. Check AGFM_PLUGIN_TOKEN is set in .env.local"
    echo "     3. From a container, localhost is the container itself — if the connection"
    echo "        is refused, set AGFM_PLUGIN_URL=http://host.docker.internal:8766"
    echo ""
fi
