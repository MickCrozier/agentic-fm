# FileMaker Setup

This folder contains the FileMaker artifacts that connect your solution to the agentic-fm toolchain.

| File               | Purpose                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `Context.fmfn`     | Custom function source — install into your FileMaker solution                                        |
| `context.xml`      | fmxmlsnippet form of the `Context` custom function                                                   |
| `agentic-fm.fmp12` | Pre-built FileMaker file containing the agentic-fm script group — open and copy/paste into your solution |
| `agentic-fm.xml`   | The same script group in fmxmlsnippet format                                                         |
| `ModifySchema.xml` | DDL executor script — required for `agfm_bridge.py ddl`                                              |

---

## Dependencies

### FileMaker Pro 21.0+

The minimum version is **21.0**. Earlier versions lack:

- `GetTableDDL` — used by `Context.fmfn` to discover foreign key relationships
- `While` — used by `Context.fmfn` for iteration
- `Create Data File` / `Open Data File` / `Write to Data File` / `Close Data File` — used to write context to disk

### agentic-fm plugin

The plugin runs on the macOS host alongside FileMaker Pro and exposes a local REST API. **It is the only path between the agent and FileMaker** — there is no companion server, AppleScript layer, or local XML export step.

Configure it with a `.env.local` at the repo root:

```env
AGFM_PLUGIN_TOKEN=your-token
AGFM_PLUGIN_PORT=8766        # optional — 8766 is the default
```

Verify the connection:

```bash
python3 agent/scripts/agfm_bridge.py status
```

Inside a dev container, `localhost` refers to the container. `agfm_bridge.py` resolves the host automatically, but you can set `AGFM_PLUGIN_URL=http://host.docker.internal:8766` explicitly if needed.

Full API reference: [agent/docs/PLUGIN.md](../agent/docs/PLUGIN.md).

### Python 3

Required for `agent/scripts/agfm_bridge.py` (the plugin interface), `agent/scripts/validate_snippet.py` (post-generation validation), and the `agent/fmlint/` package. All use Python stdlib only — no virtualenv is required.

Python 3 ships with macOS or can be installed via [Homebrew](https://brew.sh):

```bash
brew install python
```

Run scripts directly — no activation step needed:

```bash
python3 agent/scripts/agfm_bridge.py status
```

---

## Installation Steps

For the full first-run workflow, see the main [QUICKSTART.md](../QUICKSTART.md#-one-time-filemaker-setup), especially the `One-time FileMaker setup` section.

### 1. Install the Context custom function

1. Open your FileMaker solution in FileMaker Pro.
2. Go to **File > Manage > Custom Functions**.
3. Click **New** and create a function named `Context` with one parameter: `task` (type: Text).
4. Copy the entire contents of `filemaker/Context.fmfn` and paste it into the calculation editor.
5. Click **OK** and save.

### 2. Install the AGFM_Bridge script

`AGFM_Bridge` is the plugin's in-FileMaker entry point — the plugin dispatches to it for SaXML export, window management, and running scripts. Install or update it in one command:

```bash
python3 agent/scripts/agfm_bridge.py bridge-upgrade
```

This drives the Script Workspace briefly, so run it when you aren't mid-edit.

### 3. Install the remaining scripts (optional)

Open `filemaker/agentic-fm.fmp12` in FileMaker Pro. Copy the **agentic-fm** script folder from its Script Workspace and paste it into your solution's Script Workspace. This adds:

- **ModifySchema** — executes DDL passed as a script parameter; required for `agfm_bridge.py ddl`
- **AGFMScriptBridge / AGFMGoToLayout / AGFMEvaluation** — only needed for OData access to a server-hosted copy of the file
- **Agentic-fm Menu** — only needed for the web viewer custom menu integration

`filemaker/agentic-fm.xml` contains the same scripts in fmxmlsnippet form if you'd rather load them via the clipboard:

```bash
python3 agent/scripts/agfm_bridge.py clipboard-write filemaker/agentic-fm.xml
```

### 4. Confirm context

Navigate to the layout you want to work on, then:

```bash
python3 agent/scripts/agfm_bridge.py context
```

You should see your solution name, current layout, and the tables in scope. Context is read live from the plugin — there is nothing to push, and nothing to re-run between sessions.

### 5. Optional — load the discovery index

For solution-wide analysis (impact, references, orphans) and the fastest path to reading existing scripts:

```bash
python3 agent/scripts/agfm_bridge.py save-as-xml --load
```

This exports your solution as SaXML and indexes it. Once per session is enough.

---

## Optional: agentic-fm web viewer

The agentic-fm web viewer is a browser-based Monaco editor embedded directly in FileMaker. It provides a three-panel interface — script editor, XML preview, and AI chat — without leaving FileMaker Pro.

### Adding the web viewer to a layout

Add a **WebViewer** object to any layout and set its URL to `http://localhost:8080` (the Vite dev server). Name the object exactly **`agentic-fm`** — this name is required for the bridge script and custom menu integration to work correctly.

The web viewer works on any layout, but a **dedicated layout** is strongly recommended:

- Place only the web viewer object on the layout with no other interactive objects
- Make the layout window **resizable** so you can expand the editor to a comfortable size
- A single-object layout ensures the custom menu set (assigned per-layout) applies consistently whenever the editor is in use

See `webviewer/WEBVIEWER_INTEGRATION.md` for full setup and development workflow details.

### Custom menu integration (optional)

The `filemaker/custom_menu/` folder contains an optional custom menu set that adds five editor-aware menus to the layout hosting the web viewer. These menus expose keyboard shortcuts for common Monaco editor actions (comment toggle, indent, move line, find, and more) without requiring the developer to remember key bindings.

See `filemaker/custom_menu/README.md` for the integration steps.

---

## Dependency Summary

| Dependency          | Required By                                              | Where to Get                             |
| ------------------- | -------------------------------------------------------- | ---------------------------------------- |
| FileMaker Pro 21.0+ | Everything                                               | [claris.com](https://www.claris.com)     |
| agentic-fm plugin   | Everything — the only path to FileMaker                  | Install on the macOS host                |
| Python 3            | `agfm_bridge.py`, `validate_snippet.py`, `agent/fmlint/` | Ships with macOS or `brew install python` |
| Node.js 18+         | webviewer (optional)                                     | [nodejs.org](https://nodejs.org)         |
