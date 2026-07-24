---
name: setup
description: Interactive setup wizard for agentic-fm. Detects what's already configured, walks the user through each remaining step, and verifies completion before proceeding. Use when the developer says "help me set up", "setup", "get started", "onboard", "first time setup", "install agentic-fm", "configure agentic-fm", or is clearly new to the project and needs guidance.
compatibility: Requires Python 3 and the agentic-fm plugin running on a macOS host with FileMaker Pro 21.0+. Optionally Node.js for the webviewer. Optionally requests and beautifulsoup4 (via venv) for fetching the FM function reference.
---

# setup

Interactive, resumable setup wizard for agentic-fm. Walks the developer through everything required to go from a fresh clone to a working AI-assisted FileMaker scripting environment.

Setup is short, because there is only one integration point: **the agentic-fm plugin**. It runs on the macOS host beside FileMaker Pro and is the only path between the agent and FileMaker. There is no companion server, no AppleScript layer, and no local XML export step.

---

## Step 0: Environment Detection

Before presenting any steps, silently detect what is already in place. These checks determine which steps to skip.

```bash
# Python 3
python3 --version 2>&1

# Is the plugin configured?
test -f .env.local && grep -q AGFM_PLUGIN_TOKEN .env.local && echo "TOKEN_SET" || echo "NO_TOKEN"

# Is the plugin reachable? (also reports FM version, bridge status, discovery state)
python3 agent/scripts/agfm_bridge.py status 2>&1

# Node.js (optional — webviewer path)
node --version 2>&1 || echo "NOT FOUND"

# OData configured? (optional)
test -f agent/config/automation.json && echo "EXISTS" || echo "NOT FOUND"
```

### Present a status summary

After running the checks, present a checklist showing what is done and what remains. Example:

> **agentic-fm setup status**
>
> - [x] Python 3 — v3.12.1
> - [ ] Plugin token — not configured
> - [ ] Plugin connection — not reachable
> - [ ] Context custom function — unknown
> - [ ] AGFM_Bridge script — unknown
> - [ ] Node.js — not found (only needed for the webviewer)
>
> Starting from: **Step 2 — Install and configure the plugin**

Skip any step whose check passes. Resume from the first incomplete step.

---

## Step 1: Verify Python 3

**Check**: `python3 --version` succeeds.

**If missing**, tell the developer:

> Python 3 is required for `agfm_bridge.py` and the linter. Everything uses the standard library only — no virtual environment needed.
>
> **macOS**: Python 3 ships at `/usr/bin/python3`. For a newer version: `brew install python`

**Verify**: Run `python3 agent/scripts/agfm_bridge.py --help` and confirm it prints usage info.

---

## Step 2: Install and configure the plugin

**Check**: `.env.local` exists and contains `AGFM_PLUGIN_TOKEN`.

**If missing**, walk through:

> The **agentic-fm plugin** is the only bridge between me and FileMaker — context, schema queries, clipboard, and deployment all go through it.
>
> 1. Install the plugin on the Mac running FileMaker Pro
> 2. Copy the bearer token it generates
> 3. Create `.env.local` in the repo root:
>
>    ```env
>    AGFM_PLUGIN_TOKEN=your-token-here
>    AGFM_PLUGIN_PORT=8766        # optional — 8766 is the default
>    ```

**If working inside a container or non-macOS environment**, add:

> Since I'm running in a container, `localhost` reaches the container rather than your Mac. `agfm_bridge.py` handles this automatically, but if the connection is refused, set the URL explicitly:
>
> ```env
> AGFM_PLUGIN_URL=http://host.docker.internal:8766
> ```
>
> Also check that `devcontainer.json` isn't forwarding port 8766 — VS Code will loop the connection back into the container and requests will hang with no response.

Ask the developer to confirm when done.

---

## Step 3: Verify the plugin connection

**Check**:

```bash
python3 agent/scripts/agfm_bridge.py status
```

This reports the plugin version, the FileMaker version, whether `AGFM_Bridge` is available, and the discovery state.

**If it fails**, diagnose before moving on — nothing else in this wizard works without it:

| Symptom | Cause | Fix |
|---|---|---|
| Connection refused | Plugin not running | Ask the developer to start it on their Mac |
| Connection refused (container) | Wrong host | Set `AGFM_PLUGIN_URL=http://host.docker.internal:8766` |
| Hangs with no response | VS Code port forwarding loop | Remove 8766 from `forwardPorts`, rebuild the container |
| 401 / 403 | Token mismatch | Re-copy the token from the plugin into `.env.local` |

Do not proceed past this step until `status` succeeds.

---

## Step 4: Install the Context custom function

**Check**: Cannot be verified until the plugin is connected. Once it is, `agfm_bridge.py context` returning a populated response confirms it.

**If not installed**, walk through:

> The `Context` custom function is what the plugin evaluates to build my picture of your solution. Install it once per solution:
>
> 1. Open your solution in **FileMaker Pro 21.0+**
> 2. Go to **File > Manage > Custom Functions**
> 3. Click **New**
> 4. Name: `Context`
> 5. Add one parameter: `task` (type: Text)
> 6. Open `filemaker/Context.fmfn` and paste its entire contents into the calculation editor
> 7. Click **OK** and save

Ask the developer to confirm when done.

---

## Step 5: Install the AGFM_Bridge script

**Check**: `agfm_bridge.py status` reports bridge availability.

**If missing or outdated**, this is a single command — but it drives the FileMaker UI, so pause first:

> I need to install the **AGFM_Bridge** script into your solution. It's the plugin's in-FileMaker entry point — used for SaXML export, window management, and running scripts.
>
> This will take over your Script Workspace briefly. Send **g** when you're ready.

On confirmation:

```bash
python3 agent/scripts/agfm_bridge.py bridge-upgrade
```

**Verify**: Re-run `agfm_bridge.py status` and confirm the bridge is now detected.

### Optional additional scripts

> `filemaker/agentic-fm.fmp12` contains a few more scripts you may want:
>
> - **ModifySchema** — lets me create tables and add fields via DDL
> - **AGFMScriptBridge / AGFMGoToLayout / AGFMEvaluation** — only needed for OData access to a server-hosted file
>
> Open that file, copy the **agentic-fm** script folder, and paste it into your solution's Script Workspace.

---

## Step 6: Confirm context

> Navigate to a layout in your solution — whichever one you want to work on.

Then:

```bash
python3 agent/scripts/agfm_bridge.py context
```

**Verify** and report back what you found — solution name, current layout, table count:

```bash
python3 -c "
import json
d = json.load(open('agent/CONTEXT.json'))
print('Solution:', d.get('solution'))
print('Layout:  ', d.get('current_layout', {}).get('name', 'unknown'))
print('Tables:  ', len(d.get('tables', {})))
print('Scripts: ', len(d.get('scripts', {})))
"
```

If the solution or layout is not what the developer expected, say so and ask them to bring the right file to the front.

---

## Step 7: Choose your workflow

> **How do you want to work with agentic-fm?**
>
> **A. CLI / IDE** — Claude Code, Cursor, VS Code, or any terminal-based AI agent. This is the most powerful path, with access to the full skill set.
>
> **B. Webviewer** — A visual three-panel editor (Monaco + AI chat) that runs in your browser and can embed directly inside FileMaker. Good if you prefer a visual workflow.
>
> **C. Both** — They share the same plugin connection.

---

## Path A: CLI / IDE

### First session guidance

> You're all set. Here's how to start:
>
> 1. Open this directory in your AI agent (Claude Code, Cursor, etc.)
> 2. Try loading an existing script:
>    ```
>    Load script "ScriptName" and give me a description of what it does.
>    ```
> 3. Navigate to the relevant layout in FileMaker when you need field or layout awareness — I read context live, so there's nothing to push
> 4. I write scripts to `agent/sandbox/{Solution}/`, lint them, then pause and ask before deploying
> 5. Reply **g** and I'll write them straight into your Script Workspace
>
> **Every session:** just make sure the plugin is running. That's it.

### Optional — load the discovery index

> For solution-wide work — "where is this field used?", "what breaks if I rename this?", "show me unused scripts" — I need the discovery index. It exports your solution as SaXML and indexes it:
>
> ```bash
> python3 agent/scripts/agfm_bridge.py save-as-xml --load
> ```
>
> This takes a few seconds to a few minutes depending on solution size, and only needs doing once per session. It also makes reading existing scripts much faster.

This drives FileMaker, so pause for a go-ahead before running it.

---

## Path B: Webviewer

### Step B1: Verify Node.js

**Check**: `node --version` returns 18+.

**If missing or too old**:

> Node.js 18+ is required for the webviewer dev server. Install from [nodejs.org](https://nodejs.org) or via Homebrew: `brew install node`

### Step B2: Install dependencies and start

```bash
cd webviewer
npm install
npm run dev
```

The webviewer will be available at **http://localhost:8080**.

**Verify**:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080 2>/dev/null
```

### Step B3: Configure AI provider (optional)

> To use AI chat within the webviewer, configure a provider in the settings panel (gear icon), or create `webviewer/.env.local`:
>
> ```env
> AI_PROVIDER=anthropic
> AI_MODEL=sonnet
> ANTHROPIC_API_KEY=your-key-here
> ```
>
> Supported providers: `anthropic`, `openai`, `claude-code` (CLI proxy).
>
> The webviewer works without an AI provider — you can write HR scripts manually and it converts them to fmxmlsnippet automatically.

### Step B4: Embed in FileMaker (optional)

> To embed the webviewer inside FileMaker:
>
> 1. Add a **Web Viewer** object to a layout
> 2. Set the URL to `http://localhost:8080`
> 3. Name the object exactly **`agentic-fm`** (required for the bridge)
> 4. A dedicated layout with only the web viewer is recommended
>
> See `webviewer/WEBVIEWER_INTEGRATION.md` for full details.

---

## Step 8: Optional Enhancements

### OData (server-hosted files)

> **Optional:** If your file is hosted on FileMaker Server and you want me to reach that copy directly — useful for headless automation — create `agent/config/automation.json` from the example template:
>
> ```bash
> cp agent/config/automation.json.example agent/config/automation.json
> ```
>
> Then add your OData credentials. Run the `schema-build connect` skill for a guided walkthrough. This is complementary to the plugin, not a replacement.

### Custom menus (webviewer only)

> **Optional:** If you embedded the webviewer in FileMaker, `filemaker/custom_menu/` contains a custom menu set adding keyboard shortcuts for Monaco editor actions. See `filemaker/custom_menu/README.md`.

### FileMaker function reference

> **Optional:** Download the official Claris function reference for offline use.
>
> This requires `requests` and `beautifulsoup4`. Set up a venv first:
>
> ```bash
> python3 -m venv agent/.venv
> source agent/.venv/bin/activate
> pip install requests beautifulsoup4
> ```
>
> Then run the fetch script:
>
> ```bash
> agent/.venv/bin/python3 agent/docs/filemaker/fetch_docs.py
> ```

---

## Completion

When all applicable steps are done, present a final summary:

> **Setup complete!** Here's what's configured:
>
> | Component               | Status                        |
> | ----------------------- | ----------------------------- |
> | Python 3                | vX.Y.Z                        |
> | Plugin token            | configured in `.env.local`    |
> | Plugin connection       | reachable on port 8766        |
> | FileMaker Pro           | vX.Y                          |
> | Context custom function | installed                     |
> | AGFM_Bridge script      | installed                     |
> | Context                 | {Solution} / {Layout}         |
> | Discovery index         | loaded / not loaded           |
> | Workflow                | CLI/IDE / Webviewer / Both    |
>
> **Every session:**
>
> 1. Make sure the plugin is running — `python3 agent/scripts/agfm_bridge.py status`
> 2. Navigate to the layout you're working on in FileMaker
> 3. Start working with your AI agent
>
> That's the whole loop. For more details, see `QUICKSTART.md`.
