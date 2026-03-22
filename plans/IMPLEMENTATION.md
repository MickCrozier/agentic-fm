# Gradual Implementation Plan

How to execute the agentic-fm build phases using a sequential, confidence-building approach. Each phase validates the workflow before the next scales up.

---

## Dependency graph

```
   Phase 1 (Multi-Script) ← proof-of-concept ✅ merged
        │
   Phase 2 (Script Tooling) ← skills built ✅, FM validation pending
        │
   Phase 3a (Layout) ──┐ ← skills built ✅, FM validation pending
                        ├── parallel pair
   Phase 3b (OData)  ──┘ ← skills built ✅, FM validation pending
        │
   Phase 4 (Data Tooling) ← skills built ✅, FM validation pending
```

---

## Execution approach

The original plan called for 5 agents running in parallel from day one. This revision takes a gradual approach:

1. **Prove the workflow** with a single low-risk phase (Phase 1) ✅
2. **Expand incrementally** — one phase at a time, then a parallel pair
3. **Defer ambitious orchestration** — solution-level and migration skills are future potential
4. **Validate continuously** — `validate_snippet.py` gates every build; FM paste-testing confirms final output

This reduces coordination overhead, surfaces process issues early, and builds confidence before scaling up.

---

## Prerequisites

These must be in place before Phase 1 begins.

### 1. `plans/SKILL_INTERFACES.md` is final

Every agent reads this before authoring any skill that calls or is called by another skill. The interface contracts (inputs, outputs, calls, called-by) define the seams between skills.

### 3. Deployment module built ✅ Done

`agent/scripts/deploy.py` — CLI + importable module. Dispatches fmxmlsnippet output through the appropriate automation tier:

- **Tier 1** (universal): companion `/clipboard` loads clipboard via `clipboard.py`, returns paste instructions
- **Tier 2** (MBS + AppleScript, macOS): two-phase — Phase 1: FM opens target script tab via `MBS("ScriptWorkspace.OpenScript")` (the only MBS function used); Phase 2: companion fires AppleScript from outside FM to AXPress tab + paste via System Events keystrokes
- **Tier 3** (AppleScript only, macOS): single monolithic AppleScript creates, renames, and pastes into a new script — no MBS required

The module reads the developer's opt-in preference from `agent/config/automation.json`. Every skill calls it after validation; no skill hardcodes a deployment tier. See `plans/DEPLOYMENT_STATUS.md` for full status and quirks.

### 4. Shared infrastructure is locked

The following files must not be modified by any agent without coordinator approval:
- `agent/scripts/clipboard.py`
- `agent/scripts/validate_snippet.py`
- `agent/scripts/deploy.py` (deployment module)
- `agent/catalogs/step-catalog-en.json`
- `.claude/CLAUDE.md`
- Companion server endpoints

### 5. Webviewer output channel is wired ✅ Mostly done

Every skill that produces HR output uses this channel. See `plans/WEBVIEWER_STATUS.md` for full status.

**Status**:
- ✅ `POST /webviewer/push` endpoint writes to `.agent-output.json` on companion
- ✅ Webviewer polls `GET /api/agent-output` (Vite endpoint) and renders in Monaco — SSE/WebSocket are unreliable in FM WebKit, so polling is used
- ✅ `automation.json` includes `webviewer_url`
- 🔵 Not yet tested inside FM WebViewer object (works in browser)

### 6. AGFMEvaluation + snapshot infrastructure is in place

Required before `calc-eval` skill can be used. See `PHASES.md` → AGFMEvaluation + Snapshot for scope.

**Done when**:
- `AGFMEvaluation` FM script installed in solution
- Push Context writes `agent/context/snapshot.xml` and includes `snapshot_path` in CONTEXT.json output
- First reference snapshot confirmed present after a Push Context run

### 7. `fm-debug` skill is stable ✅ Done

Phase 2's `script-test` skill depends on it. Confirmed production-ready via autonomous testing 2026-03-22. See `plans/DEBUG_FINDINGS.md` for full test results. Key discovery: `Get(LastError)` resets the error state — all error data must be captured in a single expression. Documented in `agent/docs/knowledge/error-data-capture.md`.

### 8. Target solution XML is current

Phase 3a (XML2 generation) validates against `xml_parsed/` layout exports. Run `solution-export` to ensure these are up to date before Phase 3a begins. The agentic-fm scripts are exported from `agentic-fm.fmp12` (the authoritative source); layout and schema exports come from whatever solution is being developed against.

---

## Execution sequence

### Phase 1 — Multi-Script Scaffold (proof-of-concept) ✅ Merged

Skill built and available at `.claude/skills/multi-script-scaffold/` and `.cursor/skills/multi-script-scaffold/`.

---

### Phase 2 — Script Tooling ✅ Skills Built (2026-03-22)

**Purpose**: Expand the core script development capabilities with four complementary skills.

All four skills built in the `roadmap` worktree (no separate branch needed). The `script-review` skill was also rewritten as part of this work.

**What was delivered**:
- `implementation-plan` — structured planning before script creation
- `script-refactor` — analyse + improve existing scripts, tier-aware deployment, webviewer diff
- `script-debug` — systematic debug workflow, Tier 3 autonomous instrument → deploy → run → read loop
- `script-test` — generate test scripts with assertions via fm-debug
- `script-review` — rewritten with full call-tree resolution and cross-script analysis
- `fm-debug` — rewritten with tier awareness and autonomous Tier 3 workflow
- New knowledge article: `error-data-capture.md`
- Updated: `AGENTIC_DEBUG.md`, `error-handling.md`

**Remaining**:
- [ ] FM validation: test each skill against Invoice Solution scripts
- [ ] Confirm `script-test` generates valid fmxmlsnippet that runs in FM
- [ ] Confirm `script-debug` Tier 3 autonomous loop works end-to-end on a real bug

---

### Phase 3 — Layout & OData (parallel pair)

**Purpose**: Two independent workstreams that can run concurrently.

#### Phase 3a — Layout & XML2 ✅ Skills Built (2026-03-22)

Built in the `roadmap` worktree alongside Phase 3b.

**What was delivered**:
- `layout-spec` — design conversation → written layout specification
- `layout-design` — preview-first workflow: HTML with theme CSS → webviewer preview → iterate → XML2 or Web Viewer HTML
- `webviewer-build` — full HTML/CSS/JS web app + FM bridge scripts for Web Viewer path
- `extract_theme.py` — theme extraction tool: FM theme XML → `theme.css` + `theme-manifest.json` + `theme-classes.json`
- `layout-preview` webviewer payload type with Shadow DOM style isolation

**Key design decision**: Preview-first approach. The FM theme CSS constrains the design; the webviewer provides live preview; the approved design translates to either XML2 (native) or HTML (web viewer).

**Remaining**:
- [ ] FM validation: paste XML2 layout objects into Layout Mode
- [ ] Test theme extraction on the Invoice Solution
- [ ] Test layout preview in webviewer
- [ ] Test `webviewer-build` FM bridge scripts

#### Phase 3b — OData Schema ✅ Skills Built (2026-03-22)

Built in the `roadmap` worktree (no separate branch needed).

**What was delivered**:
- `schema-plan` — natural language → Mermaid ERD + FM-specific model (TOs, relationship spec)
- `schema-build` — three sub-modes: connect (OData setup), build (POST/PATCH table/field creation), relationships (click-through checklist)
- Mermaid.js integrated into webviewer AgentOutputPanel — `diagram` payload type renders Mermaid as SVG
- OData operations fully researched: endpoints, field type mappings, limitations, gotchas

**Remaining**:
- [ ] FM validation: test schema creation against live FM Server
- [ ] Test Mermaid rendering in webviewer (browser + FM WebKit)

---

### Phase 4 — Data Tooling ✅ Skills Built (2026-03-22)

Built in the `roadmap` worktree alongside Phase 3b.

**What was delivered**:
- `data-seed` — generate realistic seed data, respect referential integrity, load via OData
- `data-migrate` — import from CSV/JSON/SQL, auto-map fields, type coercion, chunked execution

**Remaining**:
- [ ] FM validation: seed test data into Invoice Solution via OData
- [ ] Test CSV/JSON import end-to-end

---

## FM validation

Agents can produce skill files and fmxmlsnippet artifacts autonomously. They cannot validate them in FileMaker. This creates a testing bottleneck.

**Handling it**:
- `validate_snippet.py` is the primary development-time gate — agents don't block on FM validation
- FM validation is batched per phase — paste and verify each artifact as a phase nears completion
- Each agent flags artifacts as ready for FM validation when produced
- The agent continues with non-FM-dependent work (prompt logic, edge cases) rather than blocking

**Validation checklist per skill**:
- [ ] Trigger phrases invoke the skill correctly
- [ ] Generated fmxmlsnippet passes `validate_snippet.py`
- [ ] Clipboard write succeeds without corruption
- [ ] Pasted result appears correctly in the target FM workspace
- [ ] Generated FM objects behave as expected at runtime

---

## Merge sequence

Phases merge in order: 1 → 2 → 3a/3b (either order) → 4.

Each merge includes:
1. Generated XML passes `validate_snippet.py`
2. FM validation checklist complete
3. Skill interfaces match `SKILL_INTERFACES.md` contracts
4. `PHASES.md` status updated (`planned` → `merged`)

---

## Coordinator responsibilities

One human should own:

- Approving any proposed changes to locked shared infrastructure files
- Reviewing and merging PRs in sequence
- Running the FM validation queue and unblocking agents when results are ready
- Updating `plans/PHASES.md` status as work progresses
- Resolving any interface contract disagreements before they diverge
- Conducting a brief retrospective after Phase 1 to adjust process for subsequent phases

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FM validation bottleneck delays merge | High | Medium | `validate_snippet.py` gates development; FM validation is batched |
| XML2 format assumptions incorrect | Medium | Medium | Phase 3a validates against `xml_parsed/` before finalising |
| OData API behaviour differs from docs | Medium | Medium | Phase 3b documents deviations in `plans/schema/odata-notes.md` |
| ~~`fm-debug` instability blocks Phase 2~~ | ~~Low~~ | ~~Medium~~ | ✅ Resolved 2026-03-22 — fm-debug confirmed stable, documented in `plans/DEBUG_FINDINGS.md` |
| Combined `schema-build` skill too large | Low | Medium | Sub-modes keep concerns separated within one skill file |
