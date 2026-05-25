# agentic-fm Plugin

The agentic-fm plugin runs on the macOS host and exposes a REST API for clipboard operations, direct Script Workspace manipulation, schema queries, UI automation, and more. It replaces most AppleScript-based automation.

## Connection

- **Port**: 8766 (host machine)
- **From dev container**: `http://host.docker.internal:8766`
- **Auth**: Bearer token — stored in `.env.local` at the project root as `AGFM_PLUGIN_TOKEN`
- **URL**: also in `.env.local` as `AGFM_PLUGIN_URL`

All requests require: `Authorization: Bearer <token>`

The old companion server moves to port **8767** when the plugin is running.

```bash
TOKEN=$(grep AGFM_PLUGIN_TOKEN /workspaces/agentic-fm/.env.local | cut -d= -f2)
URL=$(grep AGFM_PLUGIN_URL /workspaces/agentic-fm/.env.local | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" $URL/api/context
```

---

## Deploy tiers

`deploy.py` auto-upgrades to **Tier 4** when `AGFM_PLUGIN_URL` and `AGFM_PLUGIN_TOKEN` are present in `.env.local`. Tier 4 uses the plugin directly: navigate → delete all → insert → save. No AppleScript required.

Pass `--tier` explicitly to override.

### New script fallback

`deploy.py` can only deploy to **existing** scripts — it navigates by name. If a script doesn't exist yet in FileMaker:

1. Copy XML to clipboard: `POST /api/clipboard/write`
2. Tell the user: create a new script named **X** in Script Workspace, then **⌘V**

If `deploy.py` errors with "Could not navigate to", immediately fall back to clipboard copy + paste instructions.

### Replace vs patch

| Situation | Use |
|-----------|-----|
| New script being populated for the first time | Full replace (`deploy.py` with `"r"`) |
| Large change affecting many steps | Full replace |
| Small surgical edit (<~5 steps) | Patch mode (`deploy.py --patch`) |

Patch is preferred for small edits — it's safer and avoids the select-all reliability issues. Full replace is simpler for large changes. Patch requires reading current step indices first via `GET /api/ui/script`.

---

## Context & schema

**Always use the plugin as the primary context source** — it is always live and requires no Push Context step.

```bash
# Refresh context (trigger FM to regenerate on next idle)
curl -s -X POST -H "Authorization: Bearer $TOKEN" $URL/api/context/refresh

# Read current context (tables, layouts, scripts, value_lists, task)
curl -s -H "Authorization: Bearer $TOKEN" $URL/api/context

# SQL query (async — poll /api/eval/:id until complete: true)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql": "SELECT TableName, TableID FROM FileMaker_Tables"}' \
  $URL/api/query
```

Fallback order when plugin is unavailable: `CONTEXT.json` → index files → `xml_parsed/`.

---

## Endpoint reference

### Clipboard
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clipboard` | Read current FM clipboard (class, xml, size) |
| `POST` | `/api/clipboard/write` | Write fmxmlsnippet XML to FM clipboard |

> **Layout XML**: The plugin cannot switch to Layout mode or copy layout objects. Ask the user to switch to Layout mode, select all (⌘A), copy (⌘C), then read via `GET /api/clipboard`. In a container, the companion server at port 8767 is more reliable for large layout reads.

### Script Workspace (Tier 4)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ui/script/navigate` | Open a script by name; body: `{"scriptId": N, "scriptName": "Name"}` |
| `GET` | `/api/ui/script` | Read current Script Workspace content (up to 200 steps per window) |
| `POST` | `/api/ui/script/insert` | Insert fmxmlsnippet steps at `afterIndex` |
| `POST` | `/api/ui/script/delete` | Delete steps by index, or `{"all": true}` |
| `POST` | `/api/ui/script/save` | Save the open script (⌘S) — required after insert/delete |
| `POST` | `/api/ui/script/select` | Select steps by 0-based index: `{"steps": [0, 1, 2]}` |

#### Reading scripts longer than 200 steps

`GET /api/ui/script` returns a 200-step window that follows the selected step. To read a script with more than 200 steps:

1. Select step `0` → read window (`windowStart: 0, windowEnd: 200`)
2. Select the last step → read window (shifts to cover the end)
3. Merge: `window1_steps + window2_steps[200 - window2_windowStart:]`

#### Patch mode step indices

Before applying a patch, read the current step list via `GET /api/ui/script` to get accurate 0-based indices. Apply changes highest-index-first to avoid drift.

### Context & schema
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/context` | Cached solution context |
| `POST` | `/api/context/refresh` | Trigger context regeneration on next FM idle |
| `POST` | `/api/query` | Read-only SQL SELECT against FM schema (async) |
| `GET` | `/api/eval/:id` | Poll async eval/query result |

### Script execution
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/performscript` | Run a FileMaker script natively (FMX_StartScript) |
| `POST` | `/api/eval` | Submit a FileMaker calculation for evaluation |

### Conversion & validation
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/hr-to-xml` | Convert human-readable script → fmxmlsnippet |
| `POST` | `/api/xml-to-hr` | Convert fmxmlsnippet → human-readable |
| `POST` | `/api/validate` | Validate fmxmlsnippet XML |
| `POST` | `/api/lint` | Run full FMLint |

### UI automation
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ui/environment` | All windows, types, frontmost, tool state |
| `GET` | `/api/ui/layout` | Current Browse-mode layout name |
| `GET` | `/api/ui/dataviewer` | Data Viewer variables and Watch expressions |
| `POST` | `/api/ui/inspector` | Read/write/toggle/press Inspector properties |
| `POST` | `/api/ui/press` | Press a UI element by role+description |
| `POST` | `/api/ui/set` | Set value on a text field |

### Discovery (cross-reference / impact analysis)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/discovery/entity/:type/:name` | Entity detail (layout, script, table, etc.) |
| `GET` | `/api/discovery/references/:type/:name` | All references to an entity |
| `GET` | `/api/discovery/dependencies/:type/:name` | All dependencies of an entity |
| `POST` | `/api/discovery/impact` | Blast-radius analysis with severity |
| `GET` | `/api/discovery/orphans` | Unreferenced fields, scripts, custom functions |

### Server info
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/discover` | Full endpoint list |
| `GET` | `/api/health` | Server alive check, FM version, bridge availability |
