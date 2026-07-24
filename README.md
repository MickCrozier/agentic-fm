# agentic-fm 🗄️ » 📂 » 🧠

The agentic harness for empowering Claris FileMaker. Analyze solutions, generate/update scripts, design layouts, build schema & more — all through AI that understands your live FileMaker environment.

Visual introduction over at the website [agentic-fm.com](https://agentic-fm.com)

If you're a developer, and wanting to join the conversation, we've got a [Discord server](https://discord.gg/NSg7grhF) too.

**New here?** Start with [QUICKSTART.md](QUICKSTART.md) — prerequisites, install, and your first working script in one page.

# Background

FileMaker Pro is a closed environment — logic and schema live inside a binary file, not text files. Three XML formats provide the bridge between FileMaker and external tooling:

- **Database Design Report (DDR)** — a full solution export accessed via **Tools > Database Design Report...**. An older format that Claris is moving away from; not used by this project.
- **Save a Copy as XML** — the modern export format accessed via **Tools > Save a Copy as XML...**. Covers scripts, layouts, schema, and more. Can also be triggered programmatically via the Save a Copy as XML script step. This is the format this project uses.
- **fmxmlsnippet** — the clipboard format FileMaker uses to copy and paste individual objects (script steps, fields, layouts, etc.). This is the format AI uses to deliver generated code back into FileMaker.

# 🔧 How to Install

**Everything goes through the agentic-fm plugin.** The plugin runs on the macOS host alongside FileMaker Pro and exposes a local REST API for context, schema queries, clipboard, Script Workspace manipulation, and deployment. There is no AppleScript or companion-server path.

See **[filemaker/README.md](filemaker/README.md)** for the full setup guide and **[agent/docs/PLUGIN.md](agent/docs/PLUGIN.md)** for the complete API reference.

**Dependencies at a glance:**

| Dependency          | Required By                                | Notes                                                   |
| ------------------- | ------------------------------------------ | ------------------------------------------------------- |
| FileMaker Pro 21.0+ | Everything                                 | `GetTableDDL`, `While`, and data file steps required    |
| agentic-fm plugin   | Everything                                 | The only bridge between the agent and FileMaker         |
| Python 3            | `agfm_bridge.py`, `fmlint`, toolchain      | stdlib only — no virtualenv required                    |
| Node.js 18+         | webviewer (`webviewer/`)                   | Optional — only for the visual editor                   |

**Setup steps:**

1. **Install the agentic-fm plugin** on the macOS host and note the bearer token it generates.

2. **Create `.env.local`** at the repo root:

   ```env
   AGFM_PLUGIN_TOKEN=your-token
   AGFM_PLUGIN_PORT=8766        # optional — defaults to 8766
   ```

3. **Verify connectivity:**

   ```bash
   python3 agent/scripts/agfm_bridge.py status
   ```

4. **Install the `AGFM_Bridge` script** into your solution — it is the in-FileMaker counterpart the plugin dispatches to for SaXML export, window management, and file operations:

   ```bash
   python3 agent/scripts/agfm_bridge.py bridge-upgrade
   ```

5. **Confirm context** — navigate to the layout you want to work on, then:

   ```bash
   python3 agent/scripts/agfm_bridge.py context
   ```

   You are now ready to work with AI.

# ⚡ Workflow

```
0. Confirm the plugin is up: python3 agent/scripts/agfm_bridge.py status
1. Navigate FileMaker to the layout you're working on
2. AI pulls live context from the plugin (GET /api/context) — tables, fields, layouts, scripts, IDs
3. AI writes a human-readable script (.fmscript) into agent/sandbox/{Solution}/
   (the step catalog is the primary step-structure source; snippet_examples are archival)
4. fmlint runs automatically: agfm_bridge.py lint agent/sandbox/{Solution}/MyScript.fmscript
5. Developer confirms readiness, then AI deploys:
   agfm_bridge.py deploy <file> "Script Name"   — replace an existing script
   agfm_bridge.py bundle <file> --names "Name"  — create a new script
   agfm_bridge.py patch  <patch.json>           — surgical step edits
```

For solution-wide analysis (impact, references, orphans) load the discovery index once per session with
`python3 agent/scripts/agfm_bridge.py save-as-xml --load`.

# Agent Skills

Skills are opt-in workflows that extend an agent's default behavior. Invoke them naturally in conversation — no special syntax required.

**Note:** Skill use is available only to CLI/IDE editors. They are not used by the webviewer feature.

| Skill                     | What it does                                                                                                                               | Example triggers                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
|                           | **Script workflows**                                                                                                                       |                                                                            |
| **script-lookup**         | Locates a script by ID or name via the plugin — discovery index first, Script Workspace navigation as fallback                             | "review script ID 123", "show me the invoice script"                       |
| **script-preview**        | Generates a human-readable step outline for review and iteration before XML is generated                                                   | "preview the script", "outline the steps", "draft the logic"               |
| **script-review**         | Code reviews an existing script and its full call tree — evaluates error handling, structure, naming, performance, and cross-script issues | "review this script", "check the logic in X script"                        |
| **script-refactor**       | Analyzes an existing script and produces an improved version while preserving observable behavior                                          | "refactor this script", "clean up script", "optimize script"               |
| **script-debug**          | Systematic debugging — reproduce the issue, isolate the failure, form a hypothesis, verify with runtime data, produce a fix                | "debug this", "script not working", "wrong output"                         |
| **script-test**           | Generates a paired verification script that exercises a target script with known inputs and asserts expected outputs                       | "test this script", "write a test", "prove this works"                     |
| **multi-script-scaffold** | Scaffolds interdependent multi-script systems using the Untitled Placeholder Technique                                                     | "scaffold a multi-script workflow", "build script system"                  |
| **implementation-plan**   | Structured planning before script creation — decomposes requirements, identifies dependencies, surfaces FM-specific constraints            | "plan this", "decompose requirements", "plan before coding"                |
|                           | **Analysis**                                                                                                                               |                                                                            |
| **solution-analysis**     | Analyzes an entire solution — data model, scripts, UI, integrations, health — and produces a self-contained HTML report with interactive visualizations | "analyze solution", "solution overview", "what does this solution do?"      |
| **trace**                 | Traces references to a FileMaker object across the entire solution — usage reports, impact analysis, and dead object scans                 | "where is this field used?", "what breaks if I rename X?", "unused fields" |
| **extract-erd**           | Derives a true ERD (Mermaid diagram) from a solution by analyzing table occurrences, relationships, and fields                             | "extract ERD", "map the schema", "show the database structure"             |
| **fm-debug**              | Captures runtime state by instrumenting scripts with debug output and reading results back through the plugin                              | "debug this script", "analyze the runtime output", "why is this failing?"  |
|                           | **Layout and UI**                                                                                                                          |                                                                            |
| **layout-spec**           | Conducts a design conversation and produces a written layout specification — object list, field bindings, portal config, button wiring     | "layout spec", "spec out layout", "what objects should this layout have?"  |
| **layout-design**         | Generates FileMaker layout objects, previews in the webviewer, iterates with the developer, then produces XML2 or HTML output              | "design layout", "create layout objects", "build layout"                   |
| **webviewer-build**       | Generates a complete web application inside a FileMaker Web Viewer — self-contained HTML/CSS/JS with FM bridge scripts                     | "web viewer", "webviewer app", "HTML in FileMaker"                         |
| **menu-lookup**           | Locates custom menus and menu sets via the plugin and extracts the real UUIDs required for paste operations                                | "find the edit menu", "show the custom menu set", "look up menu"           |
|                           | **Schema and data**                                                                                                                        |                                                                            |
| **schema-plan**           | Designs a data model from a natural-language description — produces a Mermaid ERD and FM-specific model with TOs and relationships         | "design schema", "plan data model", "create ERD"                           |
| **schema-build**          | Creates and modifies FileMaker schema via OData REST calls — tables, fields, and relationship specifications                               | "build schema", "create tables", "create fields"                           |
| **data-seed**             | Generates realistic seed/test data and loads it into a live solution via OData                                                             | "seed data", "test data", "populate solution"                              |
| **data-migrate**          | Moves records from an external source (CSV, JSON, SQL) into a live solution via OData with field mapping and type coercion                 | "migrate data", "import records", "load CSV"                               |
|                           | **Utility**                                                                                                                                |                                                                            |
| **library-lookup**        | Searches the curated snippet library for reusable fmxmlsnippet code matching the current task                                              | "use the HTTP request script", "add a timeout loop"                        |

# Objectives

The goals of this project are to provide the guidance and context needed by agentic processes for creating reliable scripts and other FileMaker related code that can be taken from AI back into FileMaker Pro.

## Design Philosophy

The project supports both **whole-script generation** and **step-level editing**, but step-level iteration is the more common workflow. FileMaker has no diff/merge — every paste adds new steps to what is already in the script. Working at the step level is faster and less destructive, especially when modifying existing scripts.

Most of a developer's script work (creation, updates, optimizations, and debugging) happens within `agent/sandbox/`. This is the shared workspace for both the developer and AI. When working on an existing script, reference it by name using the editor's file search; AI will copy it into the sandbox as needed.

**Creating new scripts:** AI generates a sequence of steps as an `fmxmlsnippet` which is pasted directly into FileMaker via the clipboard.

**Modifying existing scripts:** Name the script and AI pulls it live from the plugin — from the discovery index (`discovery-query script_body`) when loaded, otherwise by navigating Script Workspace and reading the steps. It writes a human-readable working copy into `agent/sandbox/{Solution}/` and uses line numbers from that copy as an unambiguous reference. Conversion back to `fmxmlsnippet` happens automatically as part of the toolchain, not something the developer does manually.

# Architecture

For a detailed view of the data pipeline, the context hierarchy, artifact inventory, and guidelines for adding new features, see [ARCHITECTURE.md](ARCHITECTURE.md).

# Step Catalog

`agent/catalogs/step-catalog-en.json` is a structured JSON reference for all FileMaker script steps. It provides step IDs, parameter definitions (XML element names, types, enums, defaults), HR signatures, and Monaco snippets. The step catalog is the **single source of truth** for step XML structure, including behavioral notes (constraints, gotchas, platform notes) in its `notes` field. Agents grep it first; `snippet_examples/` is now archival reference only. See `agent/docs/SCHEMA_GUIDANCE.md` for a complete param type → XML mapping reference, and [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture.

# Webviewer

The `webviewer/` directory contains a browser-based visual script editor built with Preact, Monaco, and Vite. Its three-panel layout provides a Monaco script editor (with autocomplete from the step catalog), a live XML preview, and integrated AI chat.

**Quick start:**

```bash
cd webviewer
npm install
npm run dev
# Open http://localhost:8080
```

The webviewer can run as a standalone browser app or embedded inside a FileMaker WebViewer object. When embedded, FileMaker can push context and load scripts via the bridge API. AI providers include Anthropic API, OpenAI API, and Claude Code CLI proxy.

**The webviewer AI and the CLI/IDE agent have different capabilities.** The CLI agent has full filesystem access, reads knowledge docs selectively via the MANIFEST, and writes validated fmxmlsnippet to `agent/sandbox/`. The webviewer AI works from a pre-loaded system prompt — it has access to the same coding conventions and knowledge base, but cannot access the snippet library or the discovery index, and cannot run validation or deployment commands directly. See [CLI/IDE vs Webviewer AI](webviewer/WEBVIEWER_INTEGRATION.md#clide-vs-webviewer-ai--capability-comparison) in `WEBVIEWER_INTEGRATION.md` for a full comparison and token budget breakdown.

See `webviewer/WEBVIEWER_INTEGRATION.md` for full details.

# Project Structure

```
agentic-fm/
├── .env.local               # AGFM_PLUGIN_TOKEN / AGFM_PLUGIN_PORT (gitignored)
├── filemaker/
│   ├── Context.fmfn         # Custom function source — install into your solution
│   ├── agentic-fm.fmp12     # Pre-built FM file — open and copy/paste scripts into your solution
│   ├── agentic-fm.xml       # In-FileMaker script group in fmxmlsnippet format
│   └── README.md            # Full dependency and setup guide
├── agent/
│   ├── CONTEXT.json         # Cached solution context — written by the plugin
│   ├── CONTEXT.example.json # Schema reference and example for CONTEXT.json
│   ├── catalogs/            # Step catalog — structured step definitions
│   ├── sandbox/             # Work area for AI-generated scripts, one subfolder per solution
│   ├── config/              # automation.json (gitignored credentials)
│   ├── debug/               # Runtime debug output captured through the plugin
│   ├── scripts/             # Toolchain — agfm_bridge.py, converters, validators
│   ├── snippet_examples/    # Archival fmxmlsnippet templates (step catalog is primary)
│   ├── fmlint/              # FMLint linter package
│   ├── docs/
│   │   ├── PLUGIN.md        # Plugin API reference — the only path to FileMaker
│   │   ├── filemaker/       # FileMaker help reference (functions, script steps, errors)
│   │   └── knowledge/       # Curated behavioral intelligence about FileMaker
│   └── library/             # Proven, reusable fmxmlsnippet patterns
└── webviewer/               # Visual script editor (Preact + Monaco)
```

- **filemaker/** -- FileMaker artifacts to install into your solution, including a pre-built `.fmp12` file for fast script installation. See [filemaker/README.md](filemaker/README.md).
- **agent/catalogs/** -- Structured JSON reference for all FileMaker script steps. Primary source for step XML structure.
- **agent/scripts/agfm_bridge.py** -- The single interface to the plugin: context, queries, lint, deploy, clipboard, discovery.
- **webviewer/** -- Browser-based script editor with Monaco, live XML preview, and AI chat. See `webviewer/WEBVIEWER_INTEGRATION.md`.
- **agent/sandbox/** -- The primary working folder. All AI output lands here, organised into one subfolder per solution.
- **agent/CONTEXT.json** -- A cached snapshot of the live plugin context, scoped to the current layout and task so AI has exactly the IDs it needs. Written by the plugin, never by hand.

# Coding Conventions

All AI-generated FileMaker code (scripts and calculations) follows the conventions defined in `agent/docs/CODING_CONVENTIONS.md`. These are "initially set" based on the community standard at [filemakerstandards.org](https://filemakerstandards.org/code) and cover variable naming prefixes (`$`, `$$`, `~`, `$$~`), `Let()` formatting, operator spacing, boolean values, and control structure style.

**You can, and probably should, customize these conventions to your preferred style.** Edit `agent/docs/CODING_CONVENTIONS.md` to match your team's standards. AI reads this file before writing any calculation or script logic and will follow whatever rules you define there. Common customizations include:

- Changing variable naming conventions or casing style
- Adding project-specific prefixes or naming patterns
- Specifying preferred patterns for error handling or transaction structure
- Documenting custom functions that should always be used instead of inline logic

# Knowledge Base

`agent/docs/knowledge/` contains curated behavioral intelligence about FileMaker Pro — nuances, gotchas, and practical insights that go beyond what standard help references cover. While AI is good at logic and control flow, FileMaker has platform-specific behaviors (found set mechanics, context switching, transaction scope, window management) that are easy to get wrong without domain-specific guidance.

Each knowledge document captures what an experienced FileMaker developer knows intuitively but AI would otherwise miss. AI consults these documents before composing scripts, leading to higher-quality output that avoids common pitfalls.

**Current topics:**

| Document                    | Covers                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `found-sets.md`             | Found set attributes, actions on found sets, collecting field values, restoring found sets, snapshot links |
| `single-pass-loop.md`       | Single-pass loop pattern for structured exit control                                                       |
| `variables.md`              | Variable scoping, naming conventions, and lifetime considerations                                          |
| `error-handling.md`         | Error capture patterns, transaction rollback, and server-side compatibility                                |
| `script-parameters.md`      | Passing and parsing script parameters; JSON vs. positional patterns                                        |
| `error-data-capture.md`     | Single-expression error data capture pattern — capturing error state in one step, not many                 |
| `disambiguation.md`         | Commonly confused term pairs and non-negotiable structural rules                                           |
| `dry-coding.md`             | DRY principle in FileMaker scripts — hoisting repeated values into variables                               |
| `field-references.md`       | Field reference patterns — string-based vs. direct references, script steps vs. functions                  |
| `json-functions.md`         | Practical guidance for FileMaker's JSON functions, covering common gotchas and correct patterns            |
| `line-endings.md`           | Line endings and the paragraph character (¶) — CR vs. LF behavior in FileMaker                             |
| `paste-dependency-order.md` | Correct installation order when pasting fmxmlsnippet objects into a solution                               |
| `return-delimited-lists.md` | Searching and manipulating return-delimited (¶-separated) lists                                            |
| `terminology.md`            | FileMaker terminology glossary (redirects to full reference)                                               |
| `executesql.md`             | ExecuteSQL function guidance — SQL syntax differences, quoting, reserved words, and common gotchas         |
| `file-operations.md`        | File operation steps — deleting files, path formats, and related behaviors                                 |
| `script-ids.md`             | Script and object IDs are file-specific — not portable across FileMaker files                              |
| `custom-menu-corruption.md` | Custom menu `<Unknown>` errors in Recover — configuration issue, not true corruption                       |

A keyword-indexed manifest at `agent/docs/knowledge/MANIFEST.md` enables fast lookup. AI scans it for keyword matches against the current task and reads any matching documents before writing script steps.

**Contributing knowledge:** This is one of the most impactful ways to contribute. See `agent/docs/knowledge/CONTRIBUTING.md` for the article format, review criteria, and a list of 15 good topic ideas.

# 📋 In-FileMaker Scripts

`filemaker/agentic-fm.fmp12` is a pre-built FileMaker file containing the **agentic-fm** script folder group. Open it in FileMaker and copy/paste the script folder into your solution's Script Workspace — this is the fastest installation path. Alternatively, `filemaker/agentic-fm.xml` provides the same scripts in `fmxmlsnippet` format.

The one script that must be present is **`AGFM_Bridge`** — the plugin dispatches to it for SaXML export, window management, and file operations. Install or update it with:

```bash
python3 agent/scripts/agfm_bridge.py bridge-upgrade
```

| Script               | Purpose                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AGFM_Bridge**      | The plugin's in-FileMaker entry point. Dispatches sub-protocol commands (SaXML export, window open, webview, file open). See `GET /api/bridge/status` for the full command catalog. |
| **ModifySchema**     | Executes a DDL statement passed as a script parameter. Required for `agfm_bridge.py ddl` (create table, add field).                                                                |
| **Agentic-fm Menu**  | Handles custom menu calls and passes them through to the agentic-fm web viewer via JavaScript.                                                                                     |
| **AGFMScriptBridge** | OData entry point — accepts `{ "script": "...", "parameter": "..." }` JSON and dispatches to any named script. Required because FMS 21.x cannot route OData calls with spaces in script names. |
| **AGFMGoToLayout**   | Navigates FileMaker to a named layout — used to switch solution context to a different layout.                                                                                     |
| **AGFMEvaluation**   | Evaluates a FileMaker calculation expression server-side and returns the result; optionally navigates to a layout first.                                                           |

## Closed-Loop Operation with OData

The plugin covers the local development loop. When a FileMaker file is additionally hosted on FileMaker Server with OData enabled, an AI agent can trigger scripts on the **server** copy — useful for headless or CI-style automation where no FileMaker Pro client is running:

```bash
# Navigate the server session to a layout — dispatched through AGFMScriptBridge
curl -X POST "https://{server}/fmi/odata/v4/{database}/Script.AGFMScriptBridge" \
  -H "Authorization: Basic {base64credentials}" \
  -H "Content-Type: application/json" \
  -d '{"scriptParameterValue": "{\"script\": \"AGFMGoToLayout\", \"parameter\": \"Invoices\"}"}'

# Evaluate a calculation server-side
curl -X POST "https://{server}/fmi/odata/v4/{database}/Script.AGFMScriptBridge" \
  -H "Authorization: Basic {base64credentials}" \
  -H "Content-Type: application/json" \
  -d '{"scriptParameterValue": "{\"script\": \"AGFMEvaluation\", \"parameter\": \"Get ( FoundCount )\"}"}'
```

All OData script calls go through `AGFMScriptBridge` because FMS 21.x cannot route OData calls with spaces in script names. The bridge accepts `{ "script": "<name>", "parameter": "<optional>" }` and dispatches to the named script.

**For OData operation:**

- Host the FM file on FileMaker Server (local Docker or remote)
- Enable OData on the file with an account that has the `fmodata` extended privilege
- Install `AGFMScriptBridge`, `AGFMGoToLayout`, and `AGFMEvaluation` from `filemaker/agentic-fm.xml`

OData is complementary to the plugin, not a replacement — schema and script authoring still go through the plugin.

### Multi-file solutions

FileMaker solutions often separate UI and data across multiple files. Each file is a distinct FM solution with its own OData endpoint and account. `agent/config/automation.json` (gitignored) supports this with a `solutions` object keyed by FM file name:

```json
{
  "solutions": {
    "MyApp UI": {
      "odata": {
        "base_url": "...",
        "database": "MyApp UI",
        "username": "...",
        "password": "...",
        "script_bridge": "AGFMScriptBridge"
      }
    },
    "MyApp Data": {
      "odata": {
        "base_url": "...",
        "database": "MyApp Data",
        "username": "...",
        "password": "...",
        "script_bridge": "AGFMScriptBridge"
      }
    }
  }
}
```

The agent matches the active solution by comparing the key to the `solution` value returned by `GET /api/context` (which reflects `Get(FileName)` for the frontmost FileMaker file). Switch between files by bringing the target file to the front in FileMaker — the agent picks up the correct OData config automatically.

# Discovery system

Solution-wide analysis — impact, references, orphans, duplicates, health — runs off the plugin's discovery index. Load it once per session; it exports the solution as SaXML and indexes it in memory (backed by an on-disk SQLite cache):

```bash
python3 agent/scripts/agfm_bridge.py save-as-xml --load
```

Check whether it is already loaded with `python3 agent/scripts/agfm_bridge.py status`.

Once loaded, query it without touching Script Workspace:

```bash
# Pull a named script's full body
python3 agent/scripts/agfm_bridge.py discovery-query script_body --script "My Script"

# Find everywhere a field is referenced
python3 agent/scripts/agfm_bridge.py discovery-query text_search --text "Invoices::Amount"

# Who calls this script?
python3 agent/scripts/agfm_bridge.py discovery-query references --script "My Script"

# Unused fields, scripts, and custom functions
python3 agent/scripts/agfm_bridge.py discovery-query orphans
```

The full query catalog — 30+ query types covering schema, security, performance, triggers, cross-file references, and rule packs — is documented in [agent/docs/PLUGIN.md](agent/docs/PLUGIN.md#discovery-queries).

# validate_snippet.py

A post-generation validation tool that checks `fmxmlsnippet` output for common errors before pasting into FileMaker. Runs automatically as part of the AI toolchain — rarely needed directly.

**Usage:**

```bash
python3 agent/scripts/validate_snippet.py [file_or_directory] [options]
```

With no arguments it validates all files in `agent/sandbox/`. It auto-detects `agent/CONTEXT.json` when present.

**Checks performed:**

| Check                 | Description                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Well-formed XML       | File parses as valid XML                                                                                       |
| Root element          | Must be `<fmxmlsnippet type="FMObjectList">`                                                                   |
| No Script wrapper     | Output must not be wrapped in `<Script>` tags                                                                  |
| Step attributes       | Every `<Step>` has `enable`, `id`, and `name`                                                                  |
| Paired steps          | If/End If, Loop/End Loop, Open Transaction/Commit Transaction are balanced                                     |
| Else/Else If ordering | No Else If after Else, no duplicate Else within an If block                                                    |
| Known step names      | All step names exist in snippet_examples                                                                       |
| Reference cross-check | Field, layout, and script IDs match CONTEXT.json                                                               |
| Context staleness     | Warns if CONTEXT.json is older than 60 minutes; shows layout name at push time                                 |
| Coding conventions    | Warns on ASCII comparison operators (`<>` → `≠`, `<=` → `≤`, `>=` → `≥`) and variable naming prefix violations |

**Options:**

- `--context <path>` -- Path to CONTEXT.json (auto-detected by default)
- `--snippets <path>` -- Path to snippet_examples directory
- `--quiet, -q` -- Only show errors and warnings

# Context.fmfn

`filemaker/Context.fmfn` is a FileMaker custom function that generates the context JSON at runtime. The plugin evaluates it to serve `GET /api/context`, so it must be installed in each solution you work on — via **File > Manage > Custom Functions** (see [How to Install](#-how-to-install) above).

The function introspects the live FileMaker solution using design functions and `ExecuteSQL` queries against system tables. It automatically discovers:

- The current layout, its base table occurrence, and its named objects
- All table occurrences referenced on the layout with complete field lists (name, ID, type)
- Relationship information via `GetTableDDL` (FOREIGN KEY constraints and field comments)
- All scripts, layouts, and value lists in the solution (name + ID)

Because the output is scoped to the current layout's context, the AI receives exactly the information it needs without unnecessary noise. See `docs/Context.fmfn.md` for the full technical reference.

# CONTEXT.json

A cached snapshot of the live plugin context, written to disk by the plugin. Contains scoped context — only the tables, fields, layouts, scripts, relationships, and value lists relevant to the current task. The `generated_at` field (ISO 8601 UTC) is included for staleness detection; `validate_snippet.py` warns if the context is older than 60 minutes. Refresh it with `POST /api/context/refresh` (or `agfm_bridge.py context`) — never edit it by hand.

See `agent/CONTEXT.example.json` for the full schema and a realistic example.

# FileMaker Reference Documentation (Optional)

The `agent/docs/filemaker/` directory contains a script that fetches the official FileMaker Pro reference documentation from the Claris help site and converts it to Markdown. This is useful for giving AI agents accurate, up-to-date information about script step options, function syntax, and error codes without relying solely on training data.

> **Legal notice:** The generated Markdown files are copyrighted by Claris International Inc. They are excluded from this repository via `.gitignore` and may only be generated for personal, non-commercial use in accordance with the [Claris Website Terms of Use](https://claris.com/company/legal/terms). Do not commit, redistribute, or publish the generated files.

**Usage:**

```bash
cd agent/docs/filemaker
python3 fetch_docs.py              # fetch everything
python3 fetch_docs.py --steps      # script steps only
python3 fetch_docs.py --functions  # functions only
python3 fetch_docs.py --errors     # error codes only
python3 fetch_docs.py --force      # re-download cached files
```

**Outputs** (written relative to `agent/docs/filemaker/`):

| Path                             | Contents                                                 |
| -------------------------------- | -------------------------------------------------------- |
| `script-steps/<slug>.md`         | One file per script step (options, compatibility, notes) |
| `functions/<category>/<slug>.md` | One file per calculation function                        |
| `error-codes.md`                 | Full FileMaker error code reference                      |

Dependencies (`requests` and `beautifulsoup4`) are installed automatically on first run if not already present.

# Dependencies

See [filemaker/README.md](filemaker/README.md) for full installation instructions for each dependency.

- **agentic-fm plugin** — the only bridge between the agent and FileMaker. Runs on the macOS host; configure `AGFM_PLUGIN_TOKEN` (and optionally `AGFM_PLUGIN_PORT`, default 8766) in `.env.local`. See [agent/docs/PLUGIN.md](agent/docs/PLUGIN.md).
- **Python 3** — required by `agfm_bridge.py`, `validate_snippet.py`, and the `agent/fmlint/` package. All use stdlib only; no virtualenv is needed. Run directly with `python3 agent/scripts/...`. macOS ships Python 3 at `/usr/bin/python3`; for a newer version install via [Homebrew](https://brew.sh): `brew install python`.
- **Node.js 18+** — required by the webviewer (`webviewer/`). Optional if you only use the CLI/IDE workflow.

# Project Website

The project website is at [agentic-fm.com](https://agentic-fm.com), built with Astro and Tailwind CSS. Source is in the `website/` folder.

**Local development:**

```bash
cd website
npm install
npm run dev
```

**Deploy:** Automatic via GitHub Actions on push to `main`. See `.github/workflows/deploy.yml`.

# Contributions

Contributions are welcome. This project is intended to grow through collaboration with the FileMaker developer community.

- **Knowledge base articles** -- The more complete the knowledge base is, the higher the quality of AI-generated code. If you know of a FileMaker behavior, nuance, or gotcha that AI commonly gets wrong, write it up as a Markdown file and add it to `agent/docs/knowledge/`. Use lowercase-kebab-case filenames (e.g., `record-locking.md`, `window-management.md`) and add an entry to `agent/docs/knowledge/MANIFEST.md`. Good candidates include context switching, transaction scope, server-side vs. client-side compatibility, sort order persistence, and any platform-specific behavior that isn't obvious from the help files alone.
- **Bug reports and corrections** -- If you find an error, an omission, or a snippet that produces incorrect output, please open an issue.
- **Updated snippet examples** -- Additional and/or updated `fmxmlsnippet` templates for step types not yet covered are among the most valuable contributions.
- **Editor and workflow support** -- The core toolchain should be editor-agnostic. It was developed using Cursor. If you build support for a specific editor, IDE, or automation workflow, a pull request is welcome.
- **Webviewer and HR converter** -- Improvements to the webviewer UI, the HR-to-XML converter, Monaco autocomplete definitions, or AI chat integration. If you add or modify step catalog entries, verify the webviewer's converter handles the changes correctly.
- **Improvements to the in-FileMaker scripts** -- The FileMaker scripts in `filemaker/agentic-fm.xml` are early versions. Better error reporting and broader `AGFM_Bridge` sub-protocol coverage are good targets.

Please follow the standard fork-and-pull-request workflow. For significant changes, open an issue first to discuss the approach.
