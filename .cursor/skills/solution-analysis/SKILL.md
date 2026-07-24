---
name: solution-analysis
description: Analyze a FileMaker solution and produce a structured profile covering data model, business logic, UI layer, integrations, and health metrics. Uses the plugin's discovery system so raw XML never passes through the agent. Use when the developer says "analyze solution", "solution overview", "solution analysis", "solution profile", "solution spec", "what does this solution do", "solution summary", or wants a high-level understanding of an entire FileMaker solution.
---

# Solution Analysis

Produces a structured profile of an entire FileMaker solution — data model, business logic, UI layer, integrations, and health — without ever pulling raw XML through the agent's context.

## Architecture

### Layer 1: Discovery system (the plugin)

The plugin indexes a full SaXML export of the solution and answers structured queries against it. All the heavy lifting happens plugin-side; the agent only ever sees compact query results.

Load it once per session — this drives FileMaker, so **pause for the developer's go-ahead first**:

```bash
python3 agent/scripts/agfm_bridge.py save-as-xml --load
```

Check `agfm_bridge.py status` first; if discovery already has data, skip the load.

### Layer 2: Agentic interpretation (this skill)

Reads the query results and produces narrative insight — what the solution appears to do, how its parts connect, what patterns it follows, and what health issues deserve attention.

## Workflow

### Step 1: Confirm the plugin and identify the solution

```bash
python3 agent/scripts/agfm_bridge.py status
```

- **Plugin unreachable** → say so and stop. There is no offline copy of the solution to analyze.
- **Discovery not loaded** → ask for a go-ahead, then `agfm_bridge.py save-as-xml --load`.

Confirm which solution is loaded:

```bash
curl -s -H "Authorization: Bearer $AGFM_PLUGIN_TOKEN" \
  "http://localhost:${AGFM_PLUGIN_PORT:-8766}/api/discovery/solution"
```

This returns the loaded files, completeness, and cross-file references. If the developer named a solution that isn't loaded, say so rather than analyzing the wrong one.

### Step 2: Gather the profile (parallel batches)

These queries are independent — run each batch as parallel tool calls.

**Batch A — structure:**

```bash
python3 agent/scripts/agfm_bridge.py discovery-query files
python3 agent/scripts/agfm_bridge.py discovery-query layouts
python3 agent/scripts/agfm_bridge.py discovery-query scripts
```

Plus the schema summary:

```bash
curl -s -H "Authorization: Bearer $AGFM_PLUGIN_TOKEN" \
  "http://localhost:${AGFM_PLUGIN_PORT:-8766}/api/discovery/schema"
```

**Batch B — logic and organisation:**

```bash
python3 agent/scripts/agfm_bridge.py discovery-query folder_analysis
python3 agent/scripts/agfm_bridge.py discovery-query duplicates
python3 agent/scripts/agfm_bridge.py discovery-query triggers
python3 agent/scripts/agfm_bridge.py discovery-query cross_file
```

**Batch C — health:**

```bash
python3 agent/scripts/agfm_bridge.py discovery-query health
python3 agent/scripts/agfm_bridge.py discovery-query orphans
python3 agent/scripts/agfm_bridge.py discovery-query broken
python3 agent/scripts/agfm_bridge.py discovery-query security
python3 agent/scripts/agfm_bridge.py discovery-query performance
```

**Batch D — optional, for deeper passes:**

```bash
python3 agent/scripts/agfm_bridge.py discovery-query variables
python3 agent/scripts/agfm_bridge.py discovery-query indirection
python3 agent/scripts/agfm_bridge.py discovery-query plugin_usage
python3 agent/scripts/agfm_bridge.py discovery-query spelling_drift
python3 agent/scripts/agfm_bridge.py discovery-query file_access
```

Run Batch D only when the developer asks for a deep analysis, or when Batch C surfaces something worth chasing.

### Step 3: Map results to profile sections

| Section          | Sourced from                                              |
| ---------------- | --------------------------------------------------------- |
| Summary          | `/api/discovery/schema`, `files`, `scripts`, `layouts`    |
| Data Model       | `/api/discovery/schema`, `cross_file`                     |
| Naming           | `spelling_drift`, plus your own read of names across queries |
| Business Logic   | `scripts`, `folder_analysis`, `duplicates`, `triggers`    |
| Custom Functions | `orphans`, `duplicates`, `detail --type custom_function`  |
| UI Layer         | `layouts`, `layout_objects`, `triggers`                   |
| Integrations     | `cross_file`, `plugin_usage`, `file_access`, `indirection` |
| Multi-file       | `/api/discovery/solution`, `cross_file`                   |
| Health           | `health`, `orphans`, `broken`, `security`, `performance`  |

Write the assembled profile to `agent/sandbox/{Solution}/solution-profile.json` so later sessions can reuse it without re-querying.

### Step 4: Produce the narrative

Using the gathered data, produce a narrative specification covering:

1. **Executive Summary** — What this solution appears to be (CRM, ERP, inventory system, etc.) based on table names, script domains, and integration patterns. Mention the solution's scale (table count, script count, field count).

2. **Data Architecture** — Describe the topology pattern (anchor-buoy, spider-web, hybrid). Identify the core entity tables and how they relate. Note the naming convention and what it tells us about the development approach.

3. **Business Logic Domains** — Walk through the script folder hierarchy from `folder_analysis`. For each major folder, describe what that functional area does based on script names and entry points. Highlight the largest scripts and utility scripts that serve as shared infrastructure. Note any duplicate bodies.

4. **UI Coverage** — Which tables have layouts and which don't. Note the layout distribution and trigger usage. Call out orphaned layouts and any portals that reveal parent-child UI patterns.

5. **Integration Points** — External data sources, plugin function usage, API calls, email integration, import/export capabilities.

6. **Health Observations** — Dead objects, broken references, security patterns, performance antipatterns. Frame these as observations, not criticisms — solutions grow organically and some "dead" objects may be intentional placeholders. Verify a sample before reporting anything as definitively unused; `orphans` cannot see button-triggered or externally-called scripts.

### Step 5: Optionally produce a shareable document

If the developer wants something to circulate, write the narrative as markdown to `agent/sandbox/{Solution}/solution-profile.md`, including a Mermaid ERD (the `extract-erd` skill covers the diagram itself).

## Performance contract

- **Never pull raw SaXML through context** — discovery queries return compact structured results; that's the entire point
- **Batch independent queries** — run each batch as parallel tool calls, not sequentially
- **Load discovery once** — check `status` before reloading; a reload re-exports the whole solution
- **Query selectively for very large solutions** — Batches A and C are usually enough for a first pass; add B and D on request

## Multi-file solutions

When a solution uses a data separation model (UI file + data file) or references other FM files, discovery handles it natively.

```bash
# What's loaded, and what's referenced but missing
curl -s -H "Authorization: Bearer $AGFM_PLUGIN_TOKEN" \
  "http://localhost:${AGFM_PLUGIN_PORT:-8766}/api/discovery/solution"

# Cross-file references and external data source usage
python3 agent/scripts/agfm_bridge.py discovery-query cross_file
```

If files are referenced but not loaded, the analysis will be partial. Generate the commands to export the missing ones:

```bash
curl -s -X POST -H "Authorization: Bearer $AGFM_PLUGIN_TOKEN" \
  "http://localhost:${AGFM_PLUGIN_PORT:-8766}/api/discovery/export-missing"
```

This returns bridge commands the developer can run to export the remaining files. Each export drives FileMaker — pause for a go-ahead before running them, and state plainly in the report which files were analyzed and which were not.
