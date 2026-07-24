# agentic-fm 🗄️ » 📂 » 🧠 Quickstart

## ⚡ Fastest way to get started

Clone the repo, open it in your AI coding tool, and prompt:

> **"Help me set up agentic-fm"**

The `/setup` skill detects what's already configured, checks each dependency, and walks you through the remaining steps interactively — no need to read ahead. Everything below is the manual reference if you prefer to do it yourself.

---

## 🔀 Two ways to work

agentic-fm supports two complementary workflows — choose based on how you prefer to interact with AI:

**🌐 Webviewer** — A visual three-panel script editor (Monaco + AI chat) that runs in your browser and can be embedded directly inside a FileMaker Web Viewer. The HR-to-XML conversion happens automatically in the browser. Recommended starting point for FileMaker developers not familiar with the CLI or an IDE. See [Webviewer Setup](#webviewer-setup) below.

**🖥️ CLI / IDE** — Claude Code, Cursor, VS Code, or any terminal-based agent. The agent pulls live context from the plugin, writes a human-readable script into `agent/sandbox/`, lints it, and deploys it straight into the Script Workspace. This is the most powerful path — CLI agents have access to the full skill set, deeper context awareness, and tighter feedback loops.

---

## 💡 What this does

agentic-fm gives an AI agent structured knowledge of your FileMaker solution — schema, scripts, layouts, relationships — so it can generate reliable code that lands directly in the Script Workspace. You describe what you want; the agent writes it and deploys it through the plugin.

**Everything goes through the agentic-fm plugin.** It runs on the macOS host alongside FileMaker Pro and exposes a local REST API. There is no AppleScript, companion-server, or manual-paste fallback — if the plugin is down, the agent stops rather than guessing.

---

## ✅ Prerequisites

1. **FileMaker Pro 21.0+** — earlier versions lack required steps (`GetTableDDL`, `While`, data file steps)
2. **agentic-fm plugin** — installed and running on the macOS host; you'll need the bearer token it generates
3. **Python 3** — macOS ships Python 3 at `/usr/bin/python3`. For a newer version: `brew install python`
4. **Node.js 18+** — required only for the webviewer path, not for CLI/IDE-only usage. Install from [nodejs.org](https://nodejs.org) or via `brew install node`
5. **Your AI agent of choice** — Claude Code, Cursor, VS Code + Copilot, etc. (CLI/IDE path only)

> **Python virtual environment**: Only needed if you plan to run `agent/docs/filemaker/fetch_docs.py` to fetch Claris reference documentation. That script auto-installs `requests` and `beautifulsoup4` on first run via pip. The core scripts (`agfm_bridge.py`, `validate_snippet.py`, `agent/fmlint/`) use the Python standard library only — no venv required.

---

## 📦 Install

### 1. Clone the repo

```bash
git clone https://github.com/petrowsky/agentic-fm.git
cd agentic-fm
```

### 2. Point the repo at your plugin

Create `.env.local` at the repo root:

```env
AGFM_PLUGIN_TOKEN=your-token
AGFM_PLUGIN_PORT=8766        # optional — defaults to 8766
```

Inside a dev container, set `AGFM_PLUGIN_URL=http://host.docker.internal:8766` instead of the port.

### 3. Verify connectivity

```bash
python3 agent/scripts/agfm_bridge.py status
```

This should report the plugin version, the FileMaker version, and whether `AGFM_Bridge` is available. If it fails, nothing else in this guide will work — fix it first.

---

## 🗄️ One-time FileMaker setup

Do this once per solution. Follow the steps in order — each item may reference the one before it.

### 1. Install the Context custom function

Custom functions must be installed first because field calculations and scripts may call them by name.

1. Open your solution in FileMaker Pro
2. Go to **File > Manage > Custom Functions**
3. Click **New**, name it `Context`, add one parameter named `task` (Text)
4. Paste the contents of `filemaker/Context.fmfn` into the calculation editor
5. Click **OK**

### 2. Install the AGFM_Bridge script

`AGFM_Bridge` is the plugin's in-FileMaker entry point — the plugin dispatches to it for SaXML export, window management, and file operations. Install or update it in one command:

```bash
python3 agent/scripts/agfm_bridge.py bridge-upgrade
```

The remaining optional scripts (`ModifySchema` for DDL, `AGFMScriptBridge`/`AGFMGoToLayout`/`AGFMEvaluation` for OData) live in `filemaker/agentic-fm.fmp12` — open it in FileMaker and copy the **agentic-fm** script folder into your solution's Script Workspace.

### 3. Confirm context

Navigate to a layout in your solution, then:

```bash
python3 agent/scripts/agfm_bridge.py context
```

You should see the solution name, current layout, and the tables/fields in scope. That's the setup complete.

### 💡 Optional — load the discovery index

For solution-wide analysis (impact, references, orphans, script bodies without opening Script Workspace), load the discovery index once per session:

```bash
python3 agent/scripts/agfm_bridge.py save-as-xml --load
```

---

## 🌐 Webviewer Setup

The webviewer is a visual three-panel editor (script list + Monaco editor + AI chat) that runs in your browser and can be embedded directly in a FileMaker Web Viewer for an integrated experience.

> **Requirements:** Node.js 18+ and a running agentic-fm plugin.

### Launch the webviewer

```bash
cd webviewer
npm install
npm run dev
# Open http://localhost:8080
```

Configure your AI provider (Anthropic API key, OpenAI API key, or Claude Code CLI) in the webviewer settings panel. See the [Webviewer page](https://agentic-fm.com/webviewer/) for full embedding instructions and AI provider details.

---

## 🔄 Every session (CLI / IDE)

Each time you sit down to write scripts from the CLI or IDE:

1. **🔌 Confirm the plugin is up** — `python3 agent/scripts/agfm_bridge.py status`
2. **🗺️ Navigate** to the layout you are working on in FileMaker. The agent reads context live from the plugin — there's nothing to push.
3. **💬 In your CLI or IDE**, open the agentic-fm directory and prompt your agent to generate the script
4. The agent writes a human-readable `.fmscript` into `agent/sandbox/{Solution}/` and lints it
5. **✅ Confirm you're ready** — the agent pauses before touching FileMaker so it doesn't interrupt you mid-edit. Reply **g** and it deploys the script into the Script Workspace.

---

## 🎯 Your first CLI/IDE session

The fastest way to see agentic-fm in action is to work with a script that already exists in your solution rather than creating one from scratch. Your agent can read, explain, and improve real scripts as soon as the plugin is connected.

### Step 1 — Open your CLI or IDE

Open the agentic-fm directory in your terminal or IDE and start your agent. Then prompt it to load one of your existing scripts by name:

```
Load script "Send Invoice Email" so we can start to optimize it.
Give me a description of what the script does.
```

The agent pulls the script from the plugin — from the discovery index if loaded, otherwise by navigating Script Workspace — reads it, and returns a plain-English summary of its logic. From there you can ask it to refactor, add error handling, optimize for server execution, or anything else.

### Step 2 — Navigate for field and layout awareness

If your next prompt needs field IDs, layout references, or related tables, navigate to the relevant layout in FileMaker first. The agent reads the correct IDs live:

```
Optimize the Send Invoice Email script to use JSON for parameter passing
```

### Step 3 — Deploy

When the agent produces updated steps it lints them, then pauses and asks whether you're ready. Reply **g** and it writes the changes into the Script Workspace for you.

### Step 4 — Iterate

Keep the conversation going:

```
Add error handling around the Send Mail step and exit gracefully if it fails
```

The agent updates the file, re-lints, and redeploys.

---

## 🔧 Troubleshooting

| Problem                              | Fix                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `python3: command not found`         | Install Python 3 via [Homebrew](https://brew.sh): `brew install python`                                              |
| `agfm_bridge.py status` fails        | Confirm the plugin is running, and that `AGFM_PLUGIN_TOKEN` in `.env.local` matches the plugin's token               |
| Connection refused from a container  | Set `AGFM_PLUGIN_URL=http://host.docker.internal:8766` in `.env.local` — `localhost` won't reach the macOS host      |
| Context shows the wrong solution     | Bring the correct FileMaker file to the front, then `agfm_bridge.py context` again                                   |
| Context looks stale                  | `curl -X POST -H "Authorization: Bearer $AGFM_PLUGIN_TOKEN" localhost:8766/api/context/refresh`, then re-fetch        |
| Deploy fails partway                 | Stop — don't retry with different flags. Check what the Script Workspace shows and tell the agent                     |
| Discovery queries return nothing     | Load the index first: `python3 agent/scripts/agfm_bridge.py save-as-xml --load`                                       |
