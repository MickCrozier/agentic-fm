---
name: multi-script-scaffold
description: Scaffolds interdependent multi-script systems. Creates N named scripts via the plugin, captures their real IDs from live context, then generates all script bodies with correct Perform Script wiring in one pass. Use when the user wants to scaffold a set of interdependent scripts. Triggers on phrases like "multi-script", "scaffold scripts", "placeholder technique", "untitled placeholder", or "build a script system".
---

# Multi-Script Scaffold

Two-pass scaffold: create N named script shells → capture their real IDs from live context → generate all bodies with correct inter-script wiring → deploy.

The second pass exists because `Perform Script` steps need the numeric ID of their target, and FileMaker only assigns an ID once the script exists.

---

## Step 1: Understand the script system

If the developer has not already described the scripts to build, ask:

- How many scripts are needed?
- What does each script do (name + purpose)?
- Which scripts call which (the dependency graph)?

Build a simple dependency table, e.g.:

| # | Script Name | Calls |
|---|---|---|
| 1 | Process Invoice | Invoice - Validate, Invoice - Save |
| 2 | Invoice - Validate | — |
| 3 | Invoice - Save | — |

Confirm this with the developer before proceeding.

---

## Step 2: Fetch live context

```bash
python3 agent/scripts/agfm_bridge.py context
```

Extract:
- `solution` — the sandbox subfolder name, and the key for any OData config
- `scripts` — check whether any target script already exists (by name); if so, note its ID — it does not need creating
- `current_layout` — context during generation

Identify how many **new** scripts must be created (excluding any that already exist).

---

## Step 3: Create the script shells

The plugin creates scripts with their **final names** directly, so there is no `Untitled` placeholder or rename step. Pause for the developer's go-ahead first — this writes into their live file.

> I'm about to create **N** empty scripts in your Script Workspace: {list names}. Send **g** when you're ready.

Then create them as empty shells so FileMaker assigns each a real ID:

```bash
python3 agent/scripts/agfm_bridge.py bundle \
  agent/sandbox/{Solution}/ScriptA.fmscript \
  agent/sandbox/{Solution}/ScriptB.fmscript \
  --names "Script Name A" "Script Name B"
```

Write each `.fmscript` as a single `# (comment)` step at this stage — the real bodies come in Step 5, once every ID is known.

### Manual fallback

If the developer prefers to create them by hand, tell them:

> In FileMaker Script Workspace, click **+** N times and rename each one:
>
> | New Script # | Rename to |
> |---|---|
> | 1st | Script Name A |
> | 2nd | Script Name B |
> | … | … |
>
> Rename before saving — FileMaker names every new script `New Script`, and the context keys scripts by name, so identical names collapse to one entry.

---

## Step 4: Re-fetch context (capture the real IDs)

```bash
python3 agent/scripts/agfm_bridge.py context
```

Read the `scripts` object and extract the ID for each newly created script. Build the map:

| Script name | ID |
|---|---|
| Process Invoice | 301 |
| Invoice - Validate | 302 |
| Invoice - Save | 303 |

If any expected script is missing from the context, stop and tell the developer — do not guess an ID.

---

## Step 5: Generate all scripts

With all IDs resolved, generate every script as a human-readable `.fmscript` written to `agent/sandbox/{Solution}/`.

**Naming convention**: `{Script Name}.fmscript`.

Rules:
1. Use the real numeric IDs from the Step 4 map for all `<Script id="N" name="..."/>` references in Perform Script steps.
2. Follow all conventions in `agent/docs/CODING_CONVENTIONS.md`.
3. Grep the step catalog for every step type used.
4. Lint each file with `python3 agent/scripts/agfm_bridge.py lint agent/sandbox/{Solution}/<file>.fmscript` before proceeding to deployment.

Fix any validation errors before continuing.

---

## Step 6: Webviewer output (if available)

Push each script to the plugin's preview surface so the developer can review it before deployment:

```bash
curl -s -X POST -H "Authorization: Bearer $AGFM_PLUGIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "preview", "content": "<HR script text>"}' \
  "http://localhost:${AGFM_PLUGIN_PORT:-8766}/api/preview"
```

Push scripts sequentially so each can be reviewed in turn. If the preview surface isn't in use, output each script in HR format to the terminal instead.

---

## Step 7: Deploy

Pause for the developer's go-ahead, then deploy each script body in turn:

```bash
python3 agent/scripts/agfm_bridge.py deploy agent/sandbox/{Solution}/<Script Name>.fmscript "<Script Name>"
```

Confirm success for each before moving to the next, and report the result per script. If any deploy fails, stop and ask the developer — do not continue through the remaining scripts.

---

## Step 8: Final verification (optional)

Re-fetch context and confirm every `Perform Script` reference resolves to the intended target:

```bash
python3 agent/scripts/agfm_bridge.py context
python3 agent/scripts/agfm_bridge.py discovery-query broken
```

`broken` lists any references the solution cannot resolve — it should come back empty.

---

## Notes

- **Always confirm** the name-to-ID map before generating code — a wrong assignment means all Perform Script calls in that script will target the wrong script.
- If the scripts already exist from a prior session, skip Steps 3–4 and read their IDs from `GET /api/context`.
- Scripts with no inter-script dependencies can be generated in one pass — take existing IDs straight from `GET /api/context`.
- The webviewer push is per-script, not a batch — send one preview per script so the developer can review them in sequence.
