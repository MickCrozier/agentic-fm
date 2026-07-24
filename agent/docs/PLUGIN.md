# agentic-fm Plugin

The agentic-fm plugin runs on the macOS host and exposes a REST API for clipboard operations, direct Script Workspace manipulation, schema queries, UI automation, and more. **It is the only supported way to interact with FileMaker** — there is no AppleScript or companion-server fallback.

## Connection

- **Port**: configured via `AGFM_PLUGIN_PORT` in `.env.local` — defaults to **8766**
- **From native macOS**: `http://localhost:{port}`
- **From dev container**: `http://host.docker.internal:{port}`
- **Auth**: Bearer token — stored in `.env.local` as `AGFM_PLUGIN_TOKEN`

All requests require: `Authorization: Bearer <token>`

`agfm_bridge.py` resolves the URL automatically: reads `AGFM_PLUGIN_URL` if set, otherwise constructs the URL from `AGFM_PLUGIN_PORT` (default 8766) using the correct host for the current environment. Manually specify `AGFM_PLUGIN_URL` only when the default host/port construction is wrong for your setup.

```bash
TOKEN=$(grep AGFM_PLUGIN_TOKEN .env.local | cut -d= -f2)
PORT=$(grep AGFM_PLUGIN_PORT .env.local | cut -d= -f2); PORT=${PORT:-8766}

# Native macOS
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:${PORT}/api/context

# Dev container
curl -s -H "Authorization: Bearer $TOKEN" http://host.docker.internal:${PORT}/api/context
```

---

## Deployment

Use `agfm_bridge.py` for all deploy operations — it handles HR→XML conversion, navigation, insert, and save in one call. If the plugin is unreachable, deployment is not possible; write the `.fmscript` file and hold until the plugin is back.

```bash
# Existing script — replace all steps
python3 agent/scripts/agfm_bridge.py deploy agent/sandbox/MySolution/MyScript.fmscript "My Script"

# New script — create directly via the plugin
python3 agent/scripts/agfm_bridge.py bundle agent/sandbox/MySolution/MyScript.fmscript --names "My Script"

# Surgical edits
python3 agent/scripts/agfm_bridge.py patch agent/sandbox/MySolution/mypatch.json
```

### Replace vs patch

| Situation | Use |
|-----------|-----|
| New script | `bundle` (creates the script via `POST /api/ui/script/create`) |
| New script being populated for the first time | `deploy` (full replace) |
| Large change affecting many steps | `deploy` (full replace) |
| Small surgical edit (<~5 steps) | `patch` |

Patch is preferred for small edits — it's safer and avoids the select-all reliability issues. Full replace is simpler for large changes. Patch requires reading current step indices first via `GET /api/ui/script`.

---

## Context & schema

**The plugin is the only context source.** It is always live and requires no Push Context step. `agent/CONTEXT.json` is written by the plugin — never hand-authored, and never a substitute when the plugin is down.

```bash
# Set up TOKEN and URL once (or use: python3 agent/scripts/agfm_bridge.py context)
TOKEN=$(grep AGFM_PLUGIN_TOKEN .env.local | cut -d= -f2)
PORT=$(grep AGFM_PLUGIN_PORT .env.local | cut -d= -f2); PORT=${PORT:-8766}
URL=http://localhost:${PORT}   # use host.docker.internal inside a container

# Refresh context (trigger FM to regenerate on next idle)
curl -s -X POST -H "Authorization: Bearer $TOKEN" $URL/api/context/refresh

# Read current context (tables, layouts, scripts, value_lists, task)
curl -s -H "Authorization: Bearer $TOKEN" $URL/api/context

# SQL query (async — poll /api/eval/:id until complete: true)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql": "SELECT TableName, TableID FROM FileMaker_Tables"}' \
  $URL/api/query
```

If the plugin is unreachable, stop and tell the developer — do not guess at IDs or fall back to stale local copies.

---

## Endpoint reference

### Clipboard
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clipboard` | Read current FM clipboard (class, xml, size) |
| `POST` | `/api/clipboard/write` | Write fmxmlsnippet XML to FM clipboard |
| `POST` | `/api/clipboard/digest` | Re-digest current clipboard; returns ClipboardDigest |
| `GET` | `/api/clipboard/history` | List snapshot-store entries (active entry first) |
| `DELETE` | `/api/clipboard/history/:clipId` | Remove a historical snapshot |
| `POST` | `/api/clipboard/promote` | Promote a historical snapshot to active |
| `POST` | `/api/clipboard/patch` | Mutate a snapshot by key (clone → patch → validate → write) |
| `POST` | `/api/clipboard/inspect` | Read a sub-region of a snapshot; capped at 8 requests/turn |

> **Layout XML**: The plugin cannot switch to Layout mode or copy layout objects. Ask the user to switch to Layout mode, select all (⌘A), copy (⌘C), then read via `GET /api/clipboard`.

### Script Workspace
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ui/script/navigate` | Open a script by name; body: `{"scriptName": "Name"}` |
| `GET` | `/api/ui/script` | Read current Script Workspace content (up to 200 steps per window) |
| `POST` | `/api/ui/script/create` | Create a new script in one round-trip (navigate + insert) |
| `POST` | `/api/ui/script/insert` | Insert fmxmlsnippet steps at `afterIndex` |
| `POST` | `/api/ui/script/delete` | Delete steps by index, or `{"all": true}` |
| `POST` | `/api/ui/script/save` | Save the open script (⌘S) — required after insert/delete |
| `POST` | `/api/ui/script/select` | Select steps by 0-based index: `{"steps": [0, 1, 2]}` |

#### Reading / copying an existing script

Navigate first, then read all steps in one call:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"scriptName": "My Script"}' "$URL/api/ui/script/navigate"

curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/ui/script" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for i, s in enumerate(d.get('steps', [])):
    print(f'{i:3d}  {s}')
"
```

`GET /api/ui/script` returns all steps — no pagination required.

#### Patch mode step indices

Before applying a patch, read the current step list via `GET /api/ui/script` to get accurate 0-based indices. Apply changes highest-index-first to avoid drift.

### Context & schema
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/context` | Cached solution context |
| `POST` | `/api/context/refresh` | Trigger context regeneration on next FM idle |
| `GET` | `/api/context/lock` | Get context lock state |
| `POST` | `/api/context/lock` | Set or release context lock |
| `POST` | `/api/context/hydrate-fields` | Hydrate fields for arbitrary TO names; body: `{"to_names": [...], "fileName": "..."}` |
| `POST` | `/api/query` | Read-only SQL SELECT against FM schema (async — poll `/api/eval/:id`) |
| `POST` | `/api/eval` | Submit a FileMaker calculation for evaluation (async) |
| `GET` | `/api/eval/:id` | Poll async eval/query result until `complete: true` |

### Script execution
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/performscript` | Run a FileMaker script by name (async — poll `/api/eval/:id`). **One at a time** — concurrent calls deadlock FM. |

> For window-open, saveAsXml, webview, or file-open commands use `scriptName: "AGFM_Bridge"` with a sub-protocol parameter. See `GET /api/bridge/status` for the full command catalog.

### Conversion & validation
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/hr-to-xml` | Convert human-readable script → fmxmlsnippet |
| `POST` | `/api/xml-to-hr` | Convert fmxmlsnippet → human-readable |
| `POST` | `/api/validate` | Validate fmxmlsnippet XML (structural + semantic) |
| `POST` | `/api/validate-hr` | Validate a human-readable script (step and function names) |
| `POST` | `/api/lint` | Run full FMLint (requires repoPath in preferences) |
| `GET` | `/api/lint/status` | Check whether Python FMLint is available |

> **Local HR→XML converter**: `agent/scripts/hr_to_xml.py` converts HR to fmxmlsnippet without the plugin, but emits `id="0"` for field/layout/script references (FileMaker resolves by name on paste). Use it for offline inspection only — always deploy via the plugin endpoint.
>
> **Known bug**: The plugin's `/api/hr-to-xml` drops the `Parameter:` calculation in `Perform Script` when it spans multiple lines. The local `hr_to_xml.py` handles this correctly.

### UI automation
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ui/environment` | All FM windows, types, frontmost, tool state |
| `GET` | `/api/ui/layout` | Current Browse-mode layout name |
| `GET` | `/api/ui/dataviewer` | Data Viewer: current variables and Watch expressions |
| `POST` | `/api/ui/inspector` | Read/write/toggle/press/focus/list Inspector properties |
| `POST` | `/api/ui/press` | Press a UI element (button, checkbox, tab) by role+description |
| `POST` | `/api/ui/set` | Set value on a text field or writable control |

### FM files
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/fm/open-files` | List open FM files with name, path, size |
| `GET` | `/api/fm/open-instances` | Per-instance window enumeration (sees kiosk-style files, detects ambiguous windowNames) |
| `GET` | `/api/fm/file-stat` | Server-side filesystem stat for a path (`{exists, size}`) |

### Preview (Web Viewer rendering)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/preview` | Create a preview entry; types: `html`, `mermaid`, `svg`, `visjs`, `diff` |
| `GET` | `/api/preview/list` | JSON list of all stored previews (newest first) |
| `GET` | `/api/preview/index` | HTML list of previews for display in the agfm Web Viewer |
| `GET` | `/api/preview/:id` | Serve rendered preview page |
| `GET` | `/api/preview/:id/source` | Raw stored source JSON |
| `POST` | `/api/preview/:id/save` | Save preview to disk (opens native Save panel) |
| `POST` | `/api/preview/exchange` | Mint a single-use ticket for Web Viewer navigation |

### Schema modification (DDL)

Use `agfm_bridge.py ddl` to create tables or add fields via the `ModifySchema` FileMaker script:

```bash
# Create a new table
python3 agent/scripts/agfm_bridge.py ddl "CREATE TABLE \"CHECKLIST\" (__pkUUID varchar(255), Item varchar(255))"

# Add a field to an existing table
python3 agent/scripts/agfm_bridge.py ddl "ALTER TABLE \"INSPECTION\" ADD COLUMN \"_gIsActive\" int"
```

The DDL statement is passed as a string parameter to the `ModifySchema` script via `POST /api/performscript`. Standard FileMaker DDL syntax applies. Returns `{"success": true}` on success or `{"success": false, "error": "..."}` on failure.

> **Prerequisite:** The `ModifySchema` script must be installed in the target FileMaker solution. If it is not present, `agfm_bridge.py ddl` will return success (script error = 0) but no schema change will occur — FileMaker silently swallows calls to missing scripts. In that case, create tables manually via **Manage Database**.

---

### Discovery (cross-reference / impact analysis)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/discovery/status` | Discovery data status, loaded files, memory usage |
| `GET` | `/api/discovery/solution` | Solution definition (files, completeness, cross-file refs) |
| `PUT` | `/api/discovery/solution` | Update solution definition (rename, set primary file) |
| `GET` | `/api/discovery/schema` | Schema summary for a loaded file (tables, stats) |
| `GET` | `/api/discovery/entity/:type/:name` | Entity detail (layout, script, table, etc.) |
| `GET` | `/api/discovery/references/:type/:name` | All references to an entity |
| `GET` | `/api/discovery/dependencies/:type/:name` | All dependencies of an entity |
| `POST` | `/api/discovery/impact` | Blast-radius analysis with severity classification |
| `GET` | `/api/discovery/orphans` | Unreferenced fields, scripts, custom functions |
| `POST` | `/api/discovery/navigate` | Deep-link navigation to an entity |
| `POST` | `/api/discovery/load` | Load SaXML export for indexing |
| `POST` | `/api/discovery/load-from-cache` | Hydrate from on-disk SQLite cache |
| `POST` | `/api/discovery/refresh` | Refresh guidance; returns loaded files + bridge instructions |
| `POST` | `/api/discovery/export-missing` | Generate bridge commands to export unloaded files |
| `POST` | `/api/discovery/manifest` | Excluded files CRUD (`action: exclude|include|list`) |
| `GET` | `/api/discovery/cache/stats` | Per-solution cache stats |
| `GET` | `/api/discovery/cache/lookup` | Look up cached data for a solution by name |
| `DELETE` | `/api/discovery/data` | Clear all loaded discovery data |

#### Discovery queries

All queries accept the body form `POST /api/discovery/query {"query": "<type>", …}` or the path form `POST /api/discovery/query/<type>` — pick whichever is convenient. Use `agfm_bridge.py discovery-query <type> [--script NAME] [--text TEXT] [--file FILENAME]`.

| Query type | Body params | Description |
|------------|-------------|-------------|
| `text_search` | `text` | Free-text search across all entity names and bodies |
| `scripts` | `fileName?` | Full script roster for a file |
| `script_body` | `scriptName` | Full content of a named script — **fastest script read path when discovery is loaded** |
| `script_locate` | `scriptName` | Locate a script's file and folder path |
| `references` | `scriptName` or entity | What calls / references this entity (reverse xref) |
| `dependencies` | `scriptName` or entity | What this entity calls / depends on |
| `detail` | `type`, `name` | Full entity detail (table, layout, CF, etc.) |
| `impact` | `type`, `name` | Blast-radius analysis with severity classification |
| `orphans` | — | Unreferenced fields, scripts, and custom functions |
| `health` | — | General solution health checks |
| `broken` | — | Broken references (missing scripts, fields, layouts) |
| `security` | — | Security-related patterns (SQL injection, open auth, etc.) |
| `performance` | — | Performance antipatterns (unstored calcs in finds, etc.) |
| `variables` | — | `$variable` and `$$global` scope audit |
| `duplicates` | — | Scripts/CFs with identical bodies (hash-match) |
| `locals` | `scriptName?` | `$variable` declarations and use sites within scripts |
| `triggers` | — | Layout and field trigger inventory |
| `cross_file` | — | Cross-file references and external data source usage |
| `layout_objects` | `layoutName?` | Layout object inventory and field placements |
| `files` | — | All files in the loaded solution |
| `layouts` | `fileName?` | All layouts with base TO and folder path |
| `indirection` | — | Indirect script calls (ExecuteSQL, variable script names) |
| `step_inspect` | `scriptName` | Step-by-step inspection of a named script |
| `graph` | `type`, `name` | Dependency graph data for visualisation |
| `refresh` | — | Refresh guidance and bridge dispatch instructions |
| `plugin_usage` | — | Where each installed plugin's functions are called |
| `folder_analysis` | — | Script/CF folder coverage and density |
| `spelling_drift` | — | Identifier-name drift across the solution |
| `file_access` | — | File-access authorisation per file |
| `rule_eval` | `rules` | Run a `rules.json` rule pack against the solution |

#### Loading the discovery system

Discovery requires a one-time export + load step per session:

```bash
# Export SaXML and immediately load into discovery (recommended)
python3 agent/scripts/agfm_bridge.py save-as-xml --load

# Or load an existing SaXML directory manually
python3 agent/scripts/agfm_bridge.py discovery-load /path/to/saxmlexport
```

Check status: `GET /api/discovery/status` — `hasData: true` means queries are ready.

### Bridge
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/bridge/status` | Bridge detection status + full sub-protocol command catalog |
| `POST` | `/api/bridge/invalidate` | Force bridge availability re-check on next idle cycle |
| `POST` | `/api/bridge/copy` | Write AGFM_Bridge installer script to FM clipboard |
| `POST` | `/api/bridge/upgrade` | Auto-upgrade AGFM_Bridge via AX automation |

```bash
# Check bridge version and upgrade if needed
python3 agent/scripts/agfm_bridge.py bridge-upgrade
```

### Security
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/security/check` | Pre-flight a calculation expression against the live policy (no side effect) |
| `GET` | `/api/security/policy` | Return `security-allow.json` and `security-deny.json` contents |
| `POST` | `/api/security/reveal` | Open config or logs folder in Finder |

### Server & agent bootstrap
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/discover` | Full endpoint list with descriptions |
| `GET` | `/api/health` | Server alive check, FM version, bridge availability |
| `GET` | `/api/server/info` | Bind address, port, remote-access state, URL |
| `GET` | `/api/prompt/system` | System prompt + live capability matrix for remote agents |
| `GET` | `/api/prompt/spec` | Layer 1 core spec (HR rules, fmxmlsnippet templates, guardrails) |
| `GET` | `/api/prompt/capabilities` | Every capability with current policy (never/ask/always) |
| `GET` | `/api/capability-gaps` | Operations the plugin cannot perform (for user-instruction fallback) |
| `GET` | `/api/conventions` | Developer coding conventions from FileMaker |
