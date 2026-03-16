# Human To-Do List — Before Plan Execution

Everything the developer must provide, decide, confirm, or set up before the phases in `PHASES.md` can begin. Items are grouped by dependency — complete them roughly in order.

---

## Environment & Infrastructure

1. **Companion server running on the host** — Run on the host (not inside the agent container) so it has direct filesystem access. Must bind to `0.0.0.0` so the agent container can reach it via `http://local.hub:8765/`. FM Pro on the host calls it at `localhost:8765` as normal.

   ```bash
   COMPANION_BIND_HOST=0.0.0.0 python3 agent/scripts/companion_server.py
   ```

   Consider a launchd plist for auto-start (see `agent/docs/COMPANION_SERVER.md`).

2. **agentic-fm scripts installed in your solution** — The four FM-side scripts (`Get agentic-fm path`, `Push Context`, `Explode XML`, `Agentic-fm Debug`) must be installed and functional in every solution you plan to work with. Confirm `$$AGENTIC.FM` resolves to the correct project path.

3. **FileMaker Server with OData access (Phase 3b+)** — Required for schema-build and data tooling phases. This means:
   - A FileMaker Server instance running (Docker or native) — **confirmed working: FMS 21.1.5 in Docker container `fms`, reachable at `https://local.hub/`**
   - A hosted database file to work against — **confirmed: Invoice Solution**
   - An account with the `fmodata` extended privilege enabled — **confirmed: `Odata` account**
   - Full Access privilege for schema creation operations (CREATE TABLE, ALTER TABLE)
   - SSL handling sorted — **confirmed: mkcert CA cert mounted and trusted in agent container**
   - OData script execution workaround installed — **FMS 21.1.5 cannot route OData script calls with spaces in script names. `AGFMBridge` script installed in Invoice Solution as the routing bridge.**

---

## Context & Reference Data

4. **Run Explode XML to populate `xml_parsed/`** — Phase 3a (Layout Design) validates XML2 output against layout exports in `xml_parsed/`. These must be current before that phase starts. Run the `Explode XML` script in FM Pro against the Invoice Solution (or whichever solution you're targeting).

5. **Run Push Context on the relevant layout** — Confirm `Push Context` works end-to-end: prompts for task description, calls the `Context()` custom function, and writes a valid `agent/CONTEXT.json`. This is the primary feedback loop for every phase.

6. **Provide a test solution for multi-script validation** — Phase 1 needs to test against a 3-script and a 5-script interdependent system. Identify (or create) a solution where you can create placeholder scripts, paste generated output, and verify correct `Perform Script` wiring at runtime.

---

## Decisions You Need to Make

7. **Choose your automation tier default** — The deployment module needs your preference in `agent/config/automation.json`:
   - **Tier 1** (clipboard only, universal) — you paste manually with Cmd+V
   - **Tier 2** (MBS Plugin, macOS) — auto-paste into existing scripts, you still create scripts manually
   - **Tier 3** (MBS + AppleScript, macOS) — fully autonomous script creation and paste

   If choosing Tier 2 or 3, also confirm:
   - [ ] MBS Plugin is installed and licensed
   - [ ] (Tier 3 only) Accessibility permission granted to the controlling app in System Settings

8. **Review and finalize `SKILL_INTERFACES.md`** — This document is the contract between all skills. Every agent reads it before writing any skill that interacts with another. You must sign off that the trigger phrases, inputs, outputs, and inter-skill call relationships are correct and complete before Phase 1 starts.

9. **Confirm shared infrastructure is locked** — The following files must not be modified by agents during phase work. Review them and confirm they are stable:
   - [ ] `agent/scripts/clipboard.py`
   - [ ] `agent/scripts/validate_snippet.py`
   - [ ] `agent/catalogs/step-catalog-en.json`
   - [ ] `.claude/CLAUDE.md`
   - [ ] Companion server endpoints

---

## Stability Checks

10. **Confirm `fm-debug` skill is production-ready** — Phase 2's `script-test` skill depends on `fm-debug`. Before Phase 2 starts, verify:
    - [ ] The `Agentic-fm Debug` FM script successfully POSTs runtime state to `localhost:8765/debug`
    - [ ] `agent/debug/output.json` is written correctly and the agent can read it
    - [ ] The skill handles common failure modes (script errors, missing variables, timeout)

11. **Confirm `validate_snippet.py` covers all step types in use** — The snapshot testing infrastructure builds on this validator. Verify it catches structural errors for the step types your existing skills produce.

---

## Per-Phase Human Actions

These are not prerequisites, but they recur during execution. Know them in advance.

12. **Phase 1 (Multi-Script Scaffold)** — You will need to:
    - Create N blank placeholder scripts in FM Pro (click **+** N times)
    - Run `Push Context` to capture their IDs
    - Paste generated scripts into each placeholder (Tier 1) or approve auto-paste (Tier 2/3)
    - Rename each placeholder to its real name as directed
    - Verify correct inter-script wiring at runtime

13. **Phase 3a (Layout Design)** — You will need to:
    - Create layout shells manually in FM Pro (name, base TO)
    - Paste XML2 layout objects onto each layout in Layout Mode
    - Verify object placement, field bindings, and portal configuration

14. **Phase 3b (OData Schema)** — You will need to:
    - Manually create all relationships in the Manage Database > Relationships dialog (no API can do this)
    - Follow the click-through checklist the agent produces (TO names, join fields, cardinality, cascade delete)

15. **All phases** — You are the FM validation bottleneck. For every phase:
    - [ ] Paste generated artifacts and confirm they appear correctly
    - [ ] Run generated scripts and confirm runtime behaviour
    - [ ] Report results back so the agent can unblock

---

## Summary — Critical Path

The bare minimum to start Phase 1:

| # | Item | Status |
|---|------|--------|
| 1 | Companion server running on host (`COMPANION_BIND_HOST=0.0.0.0`) | [x] |
| 2 | agentic-fm scripts installed | [x] |
| 5 | Push Context works end-to-end | [x] |
| 6 | Test solution identified | [x] Invoice Solution |
| 7 | Automation tier chosen + `automation.json` created | [x] Tier 1 default, Tier 3 project target |
| 8 | `SKILL_INTERFACES.md` finalized | [x] |
| 9 | Shared infrastructure confirmed stable | [x] |
