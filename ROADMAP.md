# Roadmap

agentic-fm started as a precision tool for one thing: generating FileMaker scripts with an accuracy that general-purpose AI cannot match. That foundation is solid. The project now expands to cover the full surface of FileMaker development — every object type, every workflow, every stage of a solution's life.

---

## What works today

The core script workflow is production-ready:

- **Script generation** — write complete, validated scripts from a plain-English description, scoped to your solution's real field and layout IDs
- **Script review** — deep code review of a script and all subscripts it calls, with specific, actionable feedback
- **Script preview** — review the logic in human-readable form before committing to XML output
- **Debug loop** — close the feedback loop after paste: runtime state flows back to the agent automatically via the companion server, no copy/paste required
- **Custom functions** — generate and paste custom functions directly into Manage Custom Functions
- **Custom menus** — locate, create, and modify custom menus and menu sets with correct UUIDs
- **Library** — a developer managed and curated collection of proven, reusable script patterns (error handling, API requests, transaction wrappers, timeout loops, and more) that the agent draws on rather than generating from scratch

---

## In active development

### Script tooling

- **Script refactor** — analyse an existing script and produce an improved version with better error handling, cleaner variable naming, and consolidated logic — while preserving observable behaviour
- **Script modernizer** — identify older development patterns and suggest modernised replacements, with risk assessment for each change. Examples: replacing multi-step `Commit Record` loops with `Open Transaction / Commit Transaction`; replacing global-field-plus-GTRR navigation with the newer `Go to List of Records` approach
- **Multi-script scaffold** — guide the Untitled placeholder technique for complex multi-script systems: calculate how many placeholders are needed, capture their real IDs, generate all scripts in one pass with correct inter-script wiring, then walk through the renames
- **Script test** — generate a companion verification script that exercises a target script and reports pass/fail back to the agent via the debug server
- **Implementation plan** — structured planning before generation: decompose requirements, identify dependencies, and confirm the approach before writing a line of code

---

## Coming next

### Layout & UI

The full layout authoring workflow — fields, portals, buttons, popovers, tab controls, and more — generated as XML and pasted directly onto an existing layout. Two tracks:

- **Native FM layouts** — `XML2`-formatted layout objects composed to match your solution's existing conventions and pasted in
- **Web viewer applications** — full HTML/CSS/JavaScript apps embedded in a web viewer, with FileMaker bridge scripts handling data flow in and out; the UI is already web-native, so moving off FileMaker later means only migrating data

### Schema & data model

Programmatic table and field creation against a live hosted solution via OData — no manual Manage Database clicking for the fields. Relationship specifications precise enough to click through in a single focused pass. Mermaid ERDs stored in the project for reference.

### Solution-level skills

- **Solution blueprint** — decompose a plain-English application description into a complete, ordered build sequence: schema → relationships → scripts → custom functions → value lists → menus → layout specs
- **Solution audit** — analyse an existing solution for technical debt, naming inconsistencies, missing error handling, anti-patterns, and modernisation opportunities
- **Solution docs** — auto-generate human-readable documentation from the exported XML: schema, relationships, script inventory, custom functions, and privilege sets

### Custom functions & configuration

- **Function create** — generate custom functions from a description, or translate equivalent logic from another language into FileMaker calculation syntax
- **Privilege design** — design privilege sets, extended privileges, and account structure

### Migration

- **FileMaker → web** — the highest-demand migration path: parse the Database Design Report, conduct requirements discovery, recommend a target stack, and produce SQL schema, REST API design, and UI component specifications. Opinionated patterns for React + Supabase and Next.js.
- **Layout → native app** — translate FileMaker layout XML into SwiftUI or UIKit: fields become inputs, portals become list views, tab panels become tab bars
- **External → FileMaker** — bring a SQL schema, ORM model, or spreadsheet structure into FileMaker via OData, with business logic translated into scripts

### Data

- **Data seed** — generate realistic test data and load it into a live solution via OData
- **Data migrate** — move records from an external source into FileMaker with field mapping and type coercion

---

## The horizon

The goal is to describe an application in plain English and receive a complete, deployable FileMaker solution — schema built via API, scripts and configuration delivered via clipboard, layout objects pasted in, and the one step that no API can automate (creating relationships) handed to the developer as a precise click-through checklist.

Every skill, catalog, and convention in this project exists to make that possible.
