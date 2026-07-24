# Dev Container Setup

agentic-fm ships with a `.devcontainer/` configuration that lets you run Claude Code and all project tooling inside an isolated Docker container. This is the recommended way to work with agentic-fm if you want a clean, reproducible environment — or if you want to run Claude Code with expanded permissions without exposing your host operating system.

## Prerequisites

### Docker Desktop

Dev containers require Docker Desktop to be running on your machine. Download it from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop) and make sure it is running before you open the container.

### VS Code

Install the **Dev Containers** extension (`ms-vscode-remote.remote-containers`) from the VS Code Marketplace.

### Cursor

Cursor has built-in dev container support. Install the **Dev Containers** extension from Cursor's extension marketplace — it uses the same extension ID as VS Code.

---

## Opening the project in a container

1. Open the `agentic-fm` folder in VS Code or Cursor
2. When prompted *"Reopen in Container"*, click it — or open the command palette (`Cmd+Shift+P`) and run **Dev Containers: Reopen in Container**
3. The first build takes a few minutes (downloads the base image, installs Node.js and Claude Code). Subsequent opens are fast.

Once inside the container, open a terminal and confirm Claude Code is available:

```bash
claude --version
```

### API key

Claude Code needs your Anthropic API key. The devcontainer config reads it from your host environment automatically:

```bash
# Add this to your ~/.zshrc or ~/.bash_profile on your Mac
export ANTHROPIC_API_KEY=sk-ant-...
```

Restart your terminal (or run `source ~/.zshrc`) before opening the container.

---

## Why use a dev container?

### Reproducible environment

Every contributor gets identical versions of Python, Node.js, and Claude Code. No more "works on my machine" issues from mismatched tool versions.

### Safer `--dangerously-skip-permissions`

Claude Code's `--dangerously-skip-permissions` flag bypasses the approval prompts that normally gate file edits, shell commands, and tool calls. On a bare host machine this is genuinely risky — a misbehaving agent could modify files outside the project, access credentials stored in your home directory, or run destructive commands system-wide.

Inside a dev container, the blast radius shrinks dramatically:

- The agent only has access to the project folder (mounted into the container) and the container's own filesystem
- Your home directory, SSH keys, browser profiles, and other applications are not visible
- Note: `~/.claude` is mounted from the host to persist sessions — the agent can read and write Claude config, but nothing else outside the project
- The container is disposable — if something goes wrong, delete it and start fresh
- Network access can be further restricted via Docker if needed

This makes `--dangerously-skip-permissions` a much more reasonable choice for autonomous or lightly-supervised agentic workflows when running inside a container.

### Persistent Claude sessions

Your Mac's `~/.claude` folder is mounted into the container, so Claude Code login, session history, and project memory survive container rebuilds. You only need to log in once.

### Clean separation from your host

Project dependencies (npm packages, Python packages, etc.) install inside the container and never touch your host system. Removing the container removes everything.

---

## Caveats

### The plugin runs on the host

The agentic-fm plugin runs on your **Mac host** alongside FileMaker Pro, never inside the container. It is the only path between the agent and FileMaker — there is no AppleScript or companion-server fallback.

From inside the container, `localhost` refers to the container, so `agfm_bridge.py` resolves the plugin to `host.docker.internal:8766` automatically. If your setup needs something different, set it explicitly in `.env.local`:

```env
AGFM_PLUGIN_TOKEN=your-token
AGFM_PLUGIN_URL=http://host.docker.internal:8766
```

Verify with `python3 agent/scripts/agfm_bridge.py status` — `postStart.sh` runs this check on every container start.

### Do not forward port 8766

If `devcontainer.json` forwards the plugin's port, VS Code intercepts connections from the container and routes them back **into** the container, creating a loop where requests hang with no response. 8766 is deliberately absent from `forwardPorts`; leave it that way. If you add it by accident, remove it and rebuild the container.

### Clipboard and deployment

FileMaker clipboard operations and script deployment run plugin-side on the host, so they work identically from inside the container — `agfm_bridge.py deploy`, `bundle`, `patch`, `clipboard-read`, and `clipboard-write` need no special handling.

### First build time

The initial container build downloads ~1 GB of base image layers and installs Claude Code. On a fast connection this takes 3–5 minutes. Subsequent opens use the cached image and are near-instant.

### Docker Desktop resource usage

Docker Desktop runs a Linux VM in the background. It uses a modest amount of RAM and CPU even when idle. If you are on a constrained machine you may want to limit its resource allocation in Docker Desktop → Settings → Resources.
