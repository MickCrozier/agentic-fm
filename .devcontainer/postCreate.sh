#!/usr/bin/env bash
set -e

# Install system dependencies
sudo apt-get update -qq --allow-insecure-repositories 2>/dev/null || true
sudo apt-get install -y --no-install-recommends libxml2-utils

# Fix ownership of mounted host directories
sudo chown -R vscode:vscode /home/vscode/.claude /home/vscode/.config/gh 2>/dev/null || true

# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Build and install fm-xml-export-exploder
# No pre-built Linux binary is distributed — compile from source.
# Source cargo env in case the Rust feature installed to ~/.cargo but hasn't updated PATH yet.
# shellcheck source=/dev/null
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

EXPLODER_BIN="$HOME/bin/fm-xml-export-exploder"
if [ ! -x "$EXPLODER_BIN" ]; then
  echo "Building fm-xml-export-exploder..."
  git clone --depth 1 https://github.com/bc-m/fm-xml-export-exploder.git /tmp/fm-xml-export-exploder
  cd /tmp/fm-xml-export-exploder
  cargo build --release
  mkdir -p "$HOME/bin"
  cp target/release/fm-xml-export-exploder "$EXPLODER_BIN"
  chmod +x "$EXPLODER_BIN"
  cd -
  rm -rf /tmp/fm-xml-export-exploder
  echo "fm-xml-export-exploder installed at $EXPLODER_BIN"
else
  echo "fm-xml-export-exploder already installed, skipping build."
fi

# Ensure ~/bin is on PATH for this session
export PATH="$HOME/bin:$PATH"

# Verify
"$EXPLODER_BIN" --version
