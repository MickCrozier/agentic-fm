# Python

Always use `python3` — never bare `python`. macOS does not ship a `python` binary; the system Python is only available as `python3`. Core scripts and the `agent/fmlint/` package use the Python standard library only — no virtual environment is required for them.

## Virtual environment (optional — skill dependencies)

Some skills (e.g. `icon-swap`) require Python packages beyond the standard library. These are installed in an **optional venv** inside the project folder. The venv is gitignored and does not affect stdlib-only scripts.

**When to set up:** Only when a skill reports missing dependencies (e.g. `fm_svg_convert.py --check-deps` fails). Do not proactively create the venv — prompt the developer first.

**Setup (macOS):**
```bash
python3 -m venv agent/.venv
source agent/.venv/bin/activate
pip install cairosvg Pillow
```

**System dependencies (if needed for stroke-to-fill SVG conversion):**
```bash
brew install potrace
```

**Running scripts with the venv:** When the venv exists, use `agent/.venv/bin/python3` instead of bare `python3` for scripts that need the extra packages:
```bash
agent/.venv/bin/python3 agent/scripts/fm_svg_convert.py --check-deps
```

Or activate the venv first: `source agent/.venv/bin/activate`

**Important:** On some macOS configurations, `pip install` to the system Python is blocked by default. The venv approach avoids this entirely. Never suggest `sudo pip install` or `--break-system-packages`.

# Session startup

At the start of each new CLI/IDE session, before responding to the first prompt, run an update check:

```bash
git fetch origin --quiet 2>/dev/null; git rev-list HEAD..origin/main --count 2>/dev/null
```

If the result is greater than `0`, pause and notify the user before proceeding:

> **agentic-fm update available** — your clone is N commit(s) behind `origin/main`. Run `git pull --ff-only` to update before continuing, then restart your agent session. See `UPDATES.md` for details.

Do this **once per session**, not on every prompt. If the check fails (no network, not a git repo, etc.), skip it silently and continue.

## Environment detection

Also at session start, confirm the plugin is reachable — it is the only path to FileMaker:

```bash
python3 agent/scripts/agfm_bridge.py status
```

If the plugin is not reachable, say so and stop before attempting any FM operation. Read `agent/docs/SANDBOXED_ENVIRONMENT.md` when running in a container or on non-macOS — it covers reaching the plugin on the macOS host via `host.docker.internal`.

# Local development context

If `PROJECT.md` exists at the project root, read it at session start. It contains local-only context: meta-project notes, toolchain details, and `external_tools/` documentation. Its absence is normal — it is gitignored and will not be present in collaborator environments.

## Documentation Audience

- When writing docs for this project, default audience is END-USERS who download the repo as a tool, NOT collaborative developers/contributors, unless explicitly told otherwise.

# Overview

This project is designed to create FileMaker objects — in the clipboard-supported fmxmlsnippet format. Developers reference and use the HR (human-readable) format for scripts. The following folders are used.

- _sandbox/_ is where all newly created or in-progress work is stored. **Always organise sandbox files into a subfolder named after the solution** — e.g. `agent/sandbox/MySolution/MyScript.xml`. The solution name comes from the plugin `/api/context`. Never write files directly into the sandbox root.
- _catalogs/_ contains the step catalog (`step-catalog-en.json`) — a structured index of all FileMaker script steps with parameter definitions, types, enums, and HR signatures. This is the primary reference for step XML structure.
- _snippet_examples/_ is an **archival** reference folder. The step catalog is the single source of truth for step structure. Read snippet_examples only when the catalog's `notes` field is insufficient.
- _fmlint/_ is the FMLint linter package. Run via `python3 -m agent.fmlint` to validate fmxmlsnippet XML, human-readable scripts, or standalone calculation files (`.fmfn`).
- Context is everything in FileMaker. **The plugin API is the only source of context** — IDs, names, relationships, and task metadata. `agent/CONTEXT.json` is written by the plugin as a cached snapshot; it is never hand-authored and is not a fallback when the plugin is down. See **Context system** below.


# Context system

**The plugin is the only source of context.** There is no offline fallback. If the plugin is unreachable, stop and tell the developer rather than guessing at IDs or working from stale data.

## Plugin API

`AGFM_PLUGIN_TOKEN` must be set in `.env.local`. The URL is resolved automatically by `agfm_bridge.py` from `AGFM_PLUGIN_PORT` (default 8766) or `AGFM_PLUGIN_URL` if set.

```bash
TOKEN=$AGFM_PLUGIN_TOKEN
PORT=${AGFM_PLUGIN_PORT:-8766}
URL=http://localhost:${PORT}   # use host.docker.internal inside a container

# Current layout context — TOs, fields, scripts, layouts, value_lists, task
curl -s -H "Authorization: Bearer $TOKEN" $URL/api/context

# All table occurrences with IDs
curl -s -H "Authorization: Bearer $TOKEN" -X POST $URL/api/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT TableName, TableID FROM FileMaker_Tables"}'

# All fields for a specific TO
curl -s -H "Authorization: Bearer $TOKEN" -X POST $URL/api/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT FieldName, FieldType, FieldID FROM FileMaker_Fields WHERE TableName = '\''TO_NAME'\''"}'
```

`/api/query` is asynchronous — it returns `{"id": "eval-N-...", "queued": true}`. Poll `GET $URL/api/eval/:id` until `complete: true`.

`/api/context` returns: `task`, `current_layout`, `tables` (with fields), `layouts`, `scripts`, `value_lists`. All IDs are ready to use directly in fmxmlsnippet output.

**Always verify context before starting work** — check `solution`, `current_layout.name`, and `task` match the developer's request. If anything looks wrong (wrong file, wrong layout, no task), say so and ask the developer to navigate to the correct layout in FileMaker before proceeding. Call `POST /api/context/refresh` if the context appears stale, then re-fetch.

## CONTEXT.json

`agent/CONTEXT.json` is a cached snapshot written by the plugin — same schema as `/api/context`. It exists so context survives between calls, not as an offline substitute. Prefer a live `/api/context` call; refresh the file via the plugin, never by hand.

## Reading existing script content

When asked to copy, reference, or modify an existing script:

**Discovery system loaded (fastest — no Script Workspace interaction):**

Check `GET /api/discovery/status` first. If `hasData: true`, use `script_body` to pull any script by name without opening Script Workspace:

```bash
python3 agent/scripts/agfm_bridge.py discovery-query script_body --script "My Script"
```

If discovery is not loaded, load it first:
```bash
python3 agent/scripts/agfm_bridge.py save-as-xml --load
```

**Navigate + read (when discovery is not loaded):**

Use `POST /api/ui/script/navigate` to open a script by name, then `GET /api/ui/script` to read its steps.

```
GET /api/ui/script        → returns all steps[] (no pagination limit)
```

```bash
TOKEN=$AGFM_PLUGIN_TOKEN
PORT=${AGFM_PLUGIN_PORT:-8766}
URL=http://localhost:${PORT}   # use host.docker.internal inside a container
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/ui/script" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for i, s in enumerate(d.get('steps', [])):
    print(f'{i:3d}  {s}')
"
```

If the plugin is unreachable, there is no local copy of the script — ask the developer.

## Discovery system

The discovery system indexes a full SaXML export and enables solution-wide queries without touching the Script Workspace. It requires a one-time load step per session.

**Check if loaded:**
```bash
python3 agent/scripts/agfm_bridge.py status  # shows discovery state in health check
```
Or directly: `GET /api/discovery/status` — check `hasData: true`.

**Load (exports SaXML then indexes it):**
```bash
python3 agent/scripts/agfm_bridge.py save-as-xml --load
```

**Key query types:**

| Query type | What it returns | When to use |
|---|---|---|
| `script_body` | Full script content by name | Reading/modifying a named script (fastest path) |
| `text_search` | All entities mentioning a term | Finding where a field/function is used |
| `scripts` | Full script roster for a file | Getting all script names/IDs |
| `references` | What calls a given entity | Impact analysis before rename |
| `dependencies` | What a script/layout calls | Dependency graph |
| `orphans` | Unused fields, scripts, CFs | Dead-code cleanup |
| `health` | General solution health checks | Broad quality review |
| `duplicates` | Scripts/CFs with identical bodies | De-duplication |
| `locals` | $variable declarations + use sites | Variable audit |

```bash
# Pull a named script without opening Script Workspace
python3 agent/scripts/agfm_bridge.py discovery-query script_body --script "My Script"

# Find all scripts that reference a field
python3 agent/scripts/agfm_bridge.py discovery-query text_search --text "Invoices::Amount"

# Who calls "My Script"?
python3 agent/scripts/agfm_bridge.py discovery-query references --script "My Script"
```

## Automation and Deployment

The agentic-fm plugin interface (`agfm_bridge.py`) and OData-based automation are documented in `agent/docs/PLUGIN.md`. See that file for deploying changes to FileMaker and when working with `agent/config/automation.json`.

# Output format

## Scripts

**Always write scripts directly as fmxmlsnippet XML (`.xml`)** — construct the XML by hand from the step catalog's `id`, `params`, and `selfClosing` fields for each step. Do NOT write the human-readable `.fmscript` format and rely on `agfm_bridge.py`'s `/api/hr-to-xml` converter — it is unreliable and often produces incorrect step XML.

- **Always use `.xml` as the file extension** for script deliverables — never `.fmscript`.
- Use the simplified fmxmlsnippet syntax from the step catalog, NOT the verbose Save As XML (SaXML) format.
- Line numbers always reference step position within the script, not raw byte offsets.
- Scripts should be written in a testable way with clear inputs and outputs where possible
- Only produce a human-readable preview of a script when the developer explicitly asks for one — use the `script-preview` skill for this. Do not auto-generate an HR preview alongside the XML.

## Calculations
Calculations are text based. Written to `agent/sandbox/`. 
- Use .fmfn as the type

## Custom Functions
Custom Functions are stored in the Custom Function space of FileMaker. Written to `agent/sandbox/`. 
- Use .fmfn as the type
- The comment header needs to be clear what the Custom Function Name is, and what are the required inputs. These will will be translated later when converting.

## fmxmlsnippet rules

> **CRITICAL — No XML comments in fmxmlsnippet output**
>
> XML comments (`<!-- -->`) are **silently discarded** when FileMaker reads fmxmlsnippet content from the clipboard. Never use XML comments to document script intent — use FileMaker script steps instead:
>
> - **Inline comment** → `# (comment)` step (`id="89"`)
> - **Blank line** → empty self-closing `# (comment)` with no `<Text>` element
> - **Doc block comment** → disabled `Insert Text` step targeting `$README`

- XML comments within snippet_examples are for reference only — never include them in output.

- Line numbers always reference the human-readable script, never the raw XML.

# Core workflow

## Before writing scripts, functions and calculations

**MANDATORY: Before writing ANY script or function:**

1. Read the CONTEXT for the task description and all reference IDs (when present)
2. Read `agent/docs/CODING_CONVENTIONS.md` — all generated FileMaker code must follow these conventions
3. Scan `agent/docs/knowledge/MANIFEST.md` for keyword matches against the current task — read and apply matching documents
4. For scripts: grep the step catalog for each step type used (see **Step catalog** below)
5. Substitute the specific IDs/names/values from the CONTEXT

## After writing scripts, functions and calculations

**MANDATORY: After writing or updating a file within agent/sandbox/:**

6. Lint: `python3 agent/scripts/agfm_bridge.py lint agent/sandbox/<filename>` (falls back to the local `agent/fmlint/` package automatically). Fix any ERROR-severity diagnostics before presenting to the user; review WARNING-severity.
7. **Deploy confirmation — ALWAYS pause and wait for the developer to signal readiness.** The developer may be actively using FileMaker while waiting for you to prepare work. Any FM-touching operation (script deploy, bridge upgrade, save-as-xml, AX automation) will interfere if they are not ready. After lint passes, output a clear pause message and wait:

   > Ready to deploy **MyScript** → FileMaker. Send **g** when you're ready.

   Accepted responses: `g`, `go`, `y`, `yes` (case-insensitive). Anything else cancels. Do NOT use AskUserQuestion — just wait for a chat reply. This pause applies to ALL live-FM operations, not just script deploys.
8. Deploy via `agfm_bridge.py` — the plugin is the only deploy path, so `AGFM_PLUGIN_TOKEN` must be set in `.env.local`:

```bash
# Existing script — replace steps
python3 agent/scripts/agfm_bridge.py deploy agent/sandbox/MySolution/MyScript.xml "My Script"

# New script — create directly via plugin (no paste required)
python3 agent/scripts/agfm_bridge.py bundle agent/sandbox/MySolution/MyScript.xml --names "My Script"

# Surgical edits
python3 agent/scripts/agfm_bridge.py patch agent/sandbox/MySolution/mypatch.json
```

**If deploy fails, stop and ask the developer.** Do not retry with different flags or clipboard workarounds. Ask what they see and wait for their guidance.

If the plugin is unreachable, do not attempt a workaround — the `.xml` file is still the correct deliverable. Say the plugin is down and hold deployment.

**Patch file format** (for `agfm_bridge.py patch`):
```json
{
  "script": "Script Name",
  "changes": [
    { "op": "insert", "afterIndex": 5, "xml": "<fmxmlsnippet>...</fmxmlsnippet>" },
    { "op": "delete", "steps": [3, 4] },
    { "op": "replace", "steps": [7], "xml": "<fmxmlsnippet>...</fmxmlsnippet>" }
  ]
}
```

## Lookup decision tree

Two kinds of lookup are needed: **solution-specific references** (layout, field, script IDs) and **step structure** (XML elements and attributes).

1. Is it a step structure question? → Grep the step catalog. Done.
2. Everything else goes through the plugin:
   - For IDs/context: `GET /api/context` for current layout; `POST /api/query` for full schema.
   - For script content: check `GET /api/discovery/status` — if `hasData: true`, use `discovery-query script_body` instead of navigate + read.
   - For cross-solution analysis (impact, references, who-calls-what): discovery queries.
3. Plugin unreachable? → Stop and tell the developer. There is no offline lookup path.

## Step catalog

`agent/catalogs/step-catalog-en.json` is the canonical reference for all FileMaker script steps. **Never read the full file** (~200KB+). Always grep for individual entries:

```bash
grep -A 60 '"name": "Step Name"' "agent/catalogs/step-catalog-en.json"
```

**Priority order: catalog params → catalog notes → snippet_examples (archival)**

- For steps with `"status": "complete"` — construct XML directly from the catalog's `params` array, `selfClosing` flag, and `id`
- For behavioral context — check the catalog's `notes` field (`constraints`, `platform`, `gotchas`, `performance`, `behavioral`)
- Fall back to snippet_examples (path in `snippetFile`) only when notes are insufficient or status is `"auto"`/`"unfinished"`

### Key catalog fields

| Field         | Purpose                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | FileMaker internal step ID — use in `<Step id="X">`                                                                                          |
| `selfClosing` | `true` → `<Step ... />`, `false` → `<Step ...>...</Step>`                                                                                    |
| `params[]`    | Full parameter spec: `xmlElement`, `type`, `hrLabel`, `wrapperElement`, `parentElement`, `xmlAttr`, `required`, `defaultValue`, `enumValues` |
| `hrSignature` | Human-readable parameter format for HR output                                                                                                |
| `blockPair`   | Matching step partners and role (`open`/`middle`/`close`)                                                                                    |
| `notes`       | Behavioral context sub-keys                                                                                                                  |
| `snippetFile` | Path to archival snippet_examples file                                                                                                       |
| `status`      | `"complete"` / `"auto"` / `"unfinished"`                                                                                                     |

### Param types → XML emission

| Type           | XML pattern                                                                          |
| -------------- | ------------------------------------------------------------------------------------ |
| `boolean`      | `<Element xmlAttr="True\|False"/>` — check `enumValues` for HR labels                |
| `enum`         | `<Element xmlAttr="value">` or `<Element>value</Element>`                            |
| `calculation`  | `<Calculation><![CDATA[expression]]></Calculation>`                                  |
| `namedCalc`    | `<WrapperElement><Calculation><![CDATA[expression]]></Calculation></WrapperElement>` |
| `text`         | `<Element>literal text</Element>`                                                    |
| `field`        | `<Field table="TO" id="N" name="FieldName"/>` — resolve from CONTEXT.json            |
| `script`       | `<Script id="N" name="ScriptName"/>` — resolve from CONTEXT.json                     |
| `layout`       | Layout reference — resolve from CONTEXT.json                                         |
| `findRequests` | See `agent/catalogs/find-requests.md`                                                |
| `flagElement`  | Empty element presence = on, absence = off                                           |

### HR format generation

- Look up the step by name, use the `hrSignature` field for the parameter format
- If `hrSignature` is null, fall back to reading the archival snippet_examples file

# Clipboard

FileMaker objects are transferred via the macOS clipboard using proprietary binary descriptor classes — **not** plain text. Never use `pbpaste` or `pbcopy`; they corrupt multi-byte UTF-8 characters. Scripts must be converted from HR to XML before being written to the clipboard.

Use `agfm_bridge.py` for all clipboard operations — it talks to the plugin, which owns the FM clipboard:

```bash
# Write XML file to FM clipboard
python3 agent/scripts/agfm_bridge.py clipboard-write agent/sandbox/MySolution/MyScript.xml

# Read FM clipboard contents
python3 agent/scripts/agfm_bridge.py clipboard-read
```


# Custom functions

FileMaker solutions may contain custom functions. These are referenced by name in calculations (CDATA text) and do **not** require IDs in fmxmlsnippet output. The AI must know which custom functions exist so it uses them rather than inventing alternatives.

Custom functions fall into three categories:

1. **Constants** — return a fixed value (e.g. `CardWindowHeight` returns `600`). Always use the custom function name; do NOT substitute a literal number.
2. **Functional code** — general-purpose utility logic with no field references (e.g. `FormatPhone ( phoneNumber )`). Safe to call from any context.
3. **Solution-specific code** — contain references to fields or table occurrences. Before using one, verify the script will be running on a layout whose base TO supports the referenced fields.

When the CONTEXT includes a `custom_functions` section, use it. Otherwise query the plugin's discovery system:

```bash
python3 agent/scripts/agfm_bridge.py discovery-query detail --text "CustomFunctionName"
```

If discovery is not loaded, load it with `agfm_bridge.py save-as-xml --load`. If the plugin is unreachable, ask the developer which custom functions exist — do not invent them.

# Custom menus

Custom menus are a distinct object type from scripts with a different clipboard format and XML wrapper. **Before creating or modifying any custom menu XML, use the `menu-lookup` skill** to extract the real UUIDs from the plugin. Without these, FileMaker silently ignores the paste. Full details in `agent/docs/CUSTOM_MENUS.md`.

# Library

The `agent/library` folder is a curated collection of reusable fmxmlsnippet code. Use the `library-lookup` skill to access the manifest.

**Proactively** — before writing significant logic, scan the manifest for keyword matches. If found, adapt the library code rather than writing from scratch.

**Integration rules:**

- Extract inner `<Step>` elements only (not the `<Script>` wrapper) unless specifically requested
- Replace placeholder references with real values from the plugin context
- Do not remove structural or purpose comments embedded in library code

# References

- **Coding conventions**: `agent/docs/CODING_CONVENTIONS.md` — variable naming, Let() formatting, operator spacing, boolean values, control structure style
- **Knowledge base**: `agent/docs/knowledge/MANIFEST.md` — behavioral intelligence about FileMaker nuances and gotchas
- **Debugging**: Use the `fm-debug` skill when a script's behavior cannot be diagnosed from source code alone. Details in `agent/docs/AGENTIC_DEBUG.md`
- **Function reference**: `agent/docs/filemaker/functions/` — official FM function docs (not guaranteed present). Validate function names against this folder when writing calculations. Do not invent function names.
- **Schema guidance**: `agent/docs/SCHEMA_GUIDANCE.md` — complete param type → XML mapping reference
- **Documentation conventions**: When writing docs, use generic placeholder names (`SolutionApp`, `SolutionData`) instead of real solution names. Exception: when the context is explicitly about a specific solution.
- **Plugin API**: `agent/docs/PLUGIN.md` — the full endpoint reference and the only path to FileMaker
- **Sandboxed environments**: `agent/docs/SANDBOXED_ENVIRONMENT.md` — reaching the plugin from a container or non-macOS host. Read this if you detect you are not running natively on macOS.
- **Base Elements Plugin**: use the `be-plugin` skill when writing calculations or scripts that need plugin functions (file I/O, regex, crypto, SMTP, clipboard, shell, XML, PDF, zip, etc.). The skill is self-contained.

# Constraints

- When an existing script is referenced for modification, pull it from the plugin and write the working copy into _sandbox/{Solution}/_.
- XML within _snippet_examples/_ is NEVER modified. Prompt the user if changes seem needed.
- _CONTEXT.json_ is written by the plugin — never manually created or modified by AI.
- _step-catalog-en.json_ is maintained via `agent/catalogs/UPDATING_CATALOGS.md`. See `agent/docs/SCHEMA_GUIDANCE.md` for the param type → XML mapping reference.
