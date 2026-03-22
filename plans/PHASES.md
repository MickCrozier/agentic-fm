# Build Phases

Tracks the active and planned development phases of the agentic-fm vision. Each phase maps to one or more skills from `VISION.md` and lives in its own git worktree.

## Worktree conventions

- Worktrees are created under `/worktrees/` inside the container, which maps to `./worktrees/agentic-fm/` on the host.
- Branch naming: `feature/{phase-slug}`
- Worktree path: `/worktrees/{phase-slug}`

```bash
# Create a worktree for a phase
git worktree add /worktrees/schema-build feature/schema-build

# List active worktrees
git worktree list

# Remove a worktree after merge
git worktree remove /worktrees/schema-build
```

---

## Phase status legend

| Symbol | Meaning |
|---|---|
| `planned` | Scoped in VISION.md, not yet started |
| `active` | Worktree exists, work in progress |
| `merged` | Branch merged to main, worktree removed |
| `future` | Identified in VISION.md, deferred to a future cycle |

---

## Prerequisites

### Deployment Module (automation tiers) ✅ Done

The pluggable deployment module described in `VISION.md` → Automation Tiers. Cross-cutting infrastructure consumed by every skill that produces fmxmlsnippet output. See `plans/DEPLOYMENT_STATUS.md` for full build status and quirks.

**What was built**:
- `agent/scripts/deploy.py` — CLI + importable module that selects the deployment tier at runtime
- **Tier 1 (universal)**: companion `/clipboard` loads clipboard via `clipboard.py`, returns paste instructions
- **Tier 2 (MBS + AppleScript, two-phase)**: Phase 1 — companion triggers `Agentic-fm Paste` FM script via `osascript do script`, which opens the target script tab via `MBS("ScriptWorkspace.OpenScript")` (the only MBS function used). Phase 2 — companion fires a second `raw_applescript` that AXPresses the tab to focus the step editor, then pastes via System Events keystrokes.
- **Tier 3 (AppleScript only, no MBS)**: companion fires a single monolithic `raw_applescript` that creates a new script, renames it, and pastes steps — all via System Events UI automation
- Developer opt-in via `agent/config/automation.json` (default tier, per-invocation override, auto-save, multi-file targeting)
- Interactive test suite (`agent/scripts/test_deploy.py`) — 9/9 tests passing across all tiers

**Design constraint**: Tier 1 must always work. Tiers 2 and 3 are enhancements — if they fail, the module falls back to Tier 1 and reports what happened. No skill should break because a plugin is missing or Accessibility access is denied.

---

### Webviewer Output Channel

Cross-cutting output infrastructure consumed by every skill that produces HR script output. Must be built alongside the first HR-output skill — retrofitting later requires touching every skill. See `SKILL_INTERFACES.md` → Webviewer output channel for the full interface spec. See `plans/WEBVIEWER_STATUS.md` for build status, what is already built, and the test plan.

**Scope**:
- `automation.json` — add `webviewer_url` field (Vite dev server URL; distinct from process-management endpoints already built)
- **Companion endpoints**:
  - `GET /webviewer/status` — checks whether companion-spawned Vite process is alive (process state, not URL reachability)
  - `POST /webviewer/push` — accepts `{ type, content, before? }`, writes payload to `agent/config/.agent-output.json`
- **Vite API endpoint**: `GET /api/agent-output` — webviewer polls this on ~1s interval; returns payload from `.agent-output.json` or `{ "available": false }`
- **Webviewer**: "Agent output" panel with Monaco editor; polls `/api/agent-output`; diff editor for `type: "diff"` payloads
- **Payload types**: `preview` (HR display), `diff` (before/after Monaco diff editor), `result` (evaluation or structured output)

**Design constraint**: webviewer channel is always additive. Skills must still produce useful terminal output when the webviewer is unavailable. No skill should require the Vite server to be running.

**Done when**:
1. ✅ `automation.json` has `webviewer_url` field
2. ✅ `GET /webviewer/status` returns process state; URL reachability checked directly by skills
3. ✅ `POST /webviewer/push` writes payload to `.agent-output.json`
4. ✅ Webviewer "Agent output" panel displays pushed HR content in Monaco with FileMaker syntax highlighting
5. ✅ `POST /webviewer/push` with `{ "type": "diff", "content": "...", "before": "..." }` opens Monaco diff editor
6. ✅ When Vite is not running, skills detect unavailability and fall back to terminal-only output without error
7. 🔵 End-to-end test inside FM WebViewer object (polling confirmed in browser, untested in FM WebKit)
8. ✅ `POST /webviewer/push` with `{ "type": "diagram", "content": "<mermaid syntax>" }` renders Mermaid diagram as SVG (added 2026-03-22; mermaid.js lazy-loaded, dark theme, code-split into separate chunk)

---

### ~~AGFMEvaluation + Snapshot~~ ✅ Done

FM-side infrastructure for runtime calculation validation and data context capture. See `DEPLOYMENT_STATUS.md` → AGFMEvaluation + Snapshot for full design.

- **`AGFMEvaluation` FM script** — installed in agentic-fm.fmp12. Confirmed working 2026-03-18.
- **Push Context update** — `snapshot_path` and `snapshot_timestamp` in CONTEXT.json, `agent/context/snapshot.xml` written on each Push Context run. Confirmed 2026-03-19.
- **`calc-eval` skill** — deferred; not yet implemented.

---

## Phase 1 — Multi-Script Scaffold

**Status**: `merged`
**Vision ref**: What Makes This Hard → Placeholder Technique; Skills → `multi-script-scaffold`

Skill built and available at `.claude/skills/multi-script-scaffold/` and `.cursor/skills/multi-script-scaffold/`.

**What was delivered**:
- `multi-script-scaffold` skill — guides placeholder creation, captures IDs via Push Context, generates all scripts with correct Perform Script wiring, deploys per tier
- Integrated with `context-refresh` for ID capture
- Integrated with the deployment module across all three tiers
- Webviewer preview output support

---

## Phase 2 — Script Tooling Expansion

**Status**: `active` — skills built 2026-03-22, pending FM validation testing
**Vision ref**: Skills → `script-refactor`, `script-test`, `script-debug`, `implementation-plan`

**Prerequisite**: ✅ `fm-debug` confirmed stable (autonomous testing session 2026-03-22, see `plans/DEBUG_FINDINGS.md`)

**What was delivered**:

| Skill | File | Description |
|---|---|---|
| `implementation-plan` | `.claude/skills/implementation-plan/SKILL.md` | Structured planning before script creation — decompose requirements, identify dependencies, surface FM-specific constraints |
| `script-refactor` | `.claude/skills/script-refactor/SKILL.md` | Analyse existing script + full call tree, produce improved version preserving behaviour. Tier-aware deployment. Webviewer diff output. |
| `script-debug` | `.claude/skills/script-debug/SKILL.md` | Systematic reproduce → isolate → hypothesise → verify → fix. Tier 3: autonomous instrument → deploy → trigger → read → iterate loop. |
| `script-test` | `.claude/skills/script-test/SKILL.md` | Generate companion verification script with assertions, reports pass/fail via fm-debug. Tier-aware. |
| `script-review` | `.claude/skills/script-review/SKILL.md` | Rewritten — full call-tree resolution, cross-script analysis (parameter contracts, layout context, error propagation, variable scope). |

**Additional deliverables from the 2026-03-22 session**:
- `fm-debug` skill rewritten with proper frontmatter, tier awareness, and autonomous Tier 3 workflow
- New knowledge article: `agent/docs/knowledge/error-data-capture.md` — `Get(LastError)` resets error state; single-expression capture pattern
- Updated `agent/docs/AGENTIC_DEBUG.md` — corrected calling convention, forced-error technique
- Updated `agent/docs/knowledge/error-handling.md` — cross-reference to new article
- All skills include call-tree resolution: extract `Perform Script` refs → load subscripts → recurse → present tree
- `plans/DEBUG_FINDINGS.md` — full autonomous testing report

**Remaining for Phase 2 completion**:
- [ ] FM validation: test each skill against Invoice Solution scripts
- [ ] Confirm trigger phrases invoke skills correctly
- [ ] Confirm `script-test` generates valid fmxmlsnippet that runs in FM
- [ ] Confirm `script-debug` Tier 3 autonomous loop works end-to-end on a real bug

---

## Phase 3 — Layout Design & OData Schema (parallel pair)

Two independent workstreams that can run concurrently once Phases 1–2 have validated the workflow.

### Phase 3a — Layout Design & XML2 Generation

**Status**: `active` — skills + infrastructure built 2026-03-22, pending FM validation testing
**Vision ref**: Tooling Infrastructure → Layout Object Reference; Skills → `layout-design`, `layout-spec`, `webviewer-build`

**What was delivered**:

| Skill / Tool | File | Description |
|---|---|---|
| `layout-spec` | `.claude/skills/layout-spec/SKILL.md` | Design conversation → written layout specification (object list, field bindings, portal config, button wiring, style assignments) |
| `layout-design` | `.claude/skills/layout-design/SKILL.md` | Preview-first workflow: generate HTML with FM theme CSS → push to webviewer → iterate → translate to XML2 fmxmlsnippet or Web Viewer HTML |
| `webviewer-build` | `.claude/skills/webviewer-build/SKILL.md` | Full HTML/CSS/JS web app + FM bridge scripts (`FileMaker.PerformScript()` / `fmCallback()`) for Web Viewer path |
| `extract_theme.py` | `agent/scripts/extract_theme.py` | Theme extraction tool: FM theme XML → `theme.css` + `theme-manifest.json` + `theme-classes.json` |
| Layout preview | `webviewer/src/ui/AgentOutputPanel.tsx` | `layout-preview` payload type with Shadow DOM style isolation, white viewport, width indicator |

**Key design decision**: Preview-first approach. The agent designs within the FM theme's CSS constraints, previews in the webviewer, iterates with the developer, then translates the approved design to either XML2 (native FM) or Web Viewer HTML. The theme CSS serves as both the design constraint and the production stylesheet.

**Remaining for Phase 3a completion**:
- [ ] FM validation: generate XML2 layout objects and paste into FM Layout Mode
- [ ] Verify theme extraction captures all relevant CSS properties
- [ ] Test layout preview end-to-end in webviewer (browser + FM WebKit)
- [ ] Test `webviewer-build` bridge scripts (`Perform JavaScript in Web Viewer` / `FileMaker.PerformScript()`)
- [ ] Verify XML2 clipboard format produces correct layout objects when pasted

**Explicitly out of scope**: Layout container creation (permanently manual).

### Phase 3b — OData Schema Tooling

**Status**: `active` — skills built 2026-03-22, pending FM validation testing
**Vision ref**: Tooling Infrastructure → Field Definition and Schema Reference; Skills → `schema-plan`, `schema-build`

**What was delivered**:

| Skill | File | Description |
|---|---|---|
| `schema-plan` | `.claude/skills/schema-plan/SKILL.md` | Design data model from natural language → Mermaid ERD + FM-specific model with TOs and relationship spec |
| `schema-build` | `.claude/skills/schema-build/SKILL.md` | Three sub-modes: connect (OData setup walkthrough), build (POST/PATCH table/field creation via OData), relationships (click-through checklist for manual creation) |

**Additional deliverables**:
- Mermaid.js integrated into webviewer AgentOutputPanel — `diagram` payload type renders Mermaid syntax as SVG (lazy-loaded, dark theme, code-split)
- OData schema operations fully researched and documented in skill files: endpoints, field type mappings, limitations, gotchas

**Remaining for Phase 3b completion**:
- [ ] FM validation: test `schema-build` connect + build sub-modes against live FM Server
- [ ] Verify OData field type mappings produce correct FM field types
- [ ] Test Mermaid rendering end-to-end in webviewer (browser and FM WebKit)
- [ ] Confirm `schema-plan` Mermaid output renders correctly via `/webviewer/push`

**Explicitly out of scope**: Relationship creation via API (permanently manual).

---

## Phase 4 — Data Tooling

**Status**: `active` — skills built 2026-03-22, pending FM validation testing
**Vision ref**: Skills → `data-seed`, `data-migrate`

**What was delivered**:

| Skill | File | Description |
|---|---|---|
| `data-seed` | `.claude/skills/data-seed/SKILL.md` | Generate realistic seed data, respect referential integrity (parent before child), load via OData POST |
| `data-migrate` | `.claude/skills/data-migrate/SKILL.md` | Import from CSV/JSON/SQL, auto-map fields, type coercion, chunked execution, error tracking |

**Remaining for Phase 4 completion**:
- [ ] FM validation: seed test data into Invoice Solution via OData
- [ ] Test CSV/JSON import end-to-end
- [ ] Verify foreign key resolution across related tables

---

## Future Potential

The following phases are identified in `VISION.md` but deferred to a future cycle. They depend on the current phases being complete and stable, and some represent a different product category (migration) that should not compete for attention with core FM development skills.

### Solution-Level Skills

**Status**: `future`
**Vision ref**: Skills → `solution-blueprint`, `solution-audit`, `solution-docs`, `function-create`, `privilege-design`

**Depends on**: All current phases merged and stable.

`solution-blueprint` is the most ambitious skill in the roadmap — it orchestrates multiple sub-skills in sequence. When implemented, it should ship first as a **planning-only skill** that produces a build sequence document and guides the developer through manual invocations of each sub-skill. Full orchestration can follow once all sub-skills are proven stable.

**Scope** (when activated):
- `solution-blueprint` — full ordered build sequence from plain-English description (planning-only v1)
- `solution-audit` — technical debt, naming, anti-pattern analysis
- `solution-docs` — auto-generated documentation from xml_parsed
- `function-create` — custom function generation
- `privilege-design` — privilege sets and account structure

### Web Migration

**Status**: `future`
**Vision ref**: Tooling Infrastructure → Migration Tooling; Skills → `migrate-out`

Migration out of FileMaker is a different product category from core FM development assistance. While there is demand for it, the developers using agentic-fm are primarily building in FileMaker. Deferred until core skills are mature.

**Scope** (when activated):
- `migrate-out` — DDR XML → SQL schema, REST API design, UI component specs
- Build on the `migrate-filemaker` open-source foundation
- Opinionated patterns for React + Supabase and Next.js target stacks

### Native & Inbound Migration

**Status**: `future`
**Vision ref**: Skills → `migrate-native`, `migrate-in`

**Depends on**: Layout Design (Phase 3a) + OData Schema (Phase 3b).

**Scope** (when activated):
- `migrate-native` — FM layout XML → SwiftUI/UIKit Xcode project
- `migrate-in` — SQL DDL / ORM / spreadsheet → FM via OData + clipboard
