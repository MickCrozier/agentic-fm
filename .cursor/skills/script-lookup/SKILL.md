---
name: script-lookup
description: Locate a specific FileMaker script in the `agent/xml_parsed/` folder, resolving to the matching pair of scripts from `scripts_sanitized` - human-readable version - and the Save a Copy as XML (SaXML)  version. Use when the user says "review/refactor/optimize/open/show" a script, mentions "script ID", or asks about a specific script by name.
---

# Script Lookup

This skill targets a matching pair of files within the project's parsed FileMaker XML export and related artifacts, using either:

- A **numerical script ID** (preferred when provided), or
- A **script name** (exact/contains/fuzzy match).

It returns the best match and the file paths needed to review/refactor it safely.

## Quick start

When invoked:

1. Extract **script ID** and/or **script name** from the user's request.
2. Look for any existing **fmxmlsnippet** version to use as an editable base within these locations. In-progress work may be ongoing check this folder first.
   - `agent/sandbox`
3. Locate the paired parsed XML artifacts. These are the original references for anything from the previous step.
   - `scripts_sanitized` (readable)
   - `scripts` (Save-As-XML reference)
4. Output the **Script match report** (template below) also indicating location.
5. Use `AskQuestion` to confirm this is the intended target script (see **Confirmation step** below).
6. If confirmed and the user asked to **review/refactor/optimize**, proceed with the handoff workflow.

### Parsed XML artifacts (read-only reference)

- `agent/xml_parsed/scripts_sanitized/` (human-readable; best for quick understanding + matching)
- `agent/xml_parsed/scripts/` (FileMaker "Save a Copy As XML" format; **never** output directly)

**If `agent/xml_parsed/` does not exist or is empty**, report that explicitly and stop the lookup (do not guess and do not use anything else in the folder hierarchy).

## Interpreting the user's request

### Script ID extraction

Treat these as script IDs:

- "ID 123", "script 123", "script id: 123", "#123"

### Script name extraction

If no ID is present, treat the remainder as a script name hint, e.g.:

- "review the new invoice for client script" → name hint: "new invoice for client"

Normalize name hints:

- Case-insensitive
- Remove the trailing word "script"
- Collapse repeated whitespace/punctuation

## Matching workflow (deterministic, then fuzzy)

Follow this order and stop at the first **high confidence** match:

1. **ID match** (highest confidence)
   - Find a script with that ID (The file name will always include the id such as `... - ID 123$`).
   - Use `fd` first if avaiable.
   - Use a variation of `find . -type f -name "*103*"` within the `agent/xml_parsed` and modify find as needed.
2. **Exact name match** (case-insensitive)
3. **Contains match** (all tokens present in candidate name)
4. **Fuzzy match** (rank candidates; return top 3–5)

If multiple candidates are close:

- Choose the best match and continue.
- Include alternates in the Script match report so the user can redirect quickly.
- The `AskQuestion` confirmation step (below) acts as the natural redirect gate — do not separately block on a question here.

## Mapping between sanitized and Save-As-XML variants

The sanitized and XML variants should be treated as a pair.

- **Primary key**: script ID (preferred over name when available)
- **Secondary**: script name + folder path

When ID and name conflict, **trust ID**.

## Script match report (always include)

Return a compact report with these sections:

- **Selected script**
  - Name: `<script name>`
  - ID: `<id or unknown>`
  - Confidence: High/Medium/Low (why)

- **Paths found**
  - Sanitized (readable): `<path or "not found">`
  - Save-As-XML (reference): `<path or "not found">`
  - fmxmlsnippet (editable base): `<path in agent/scripts or agent/sandbox, or "not found">`

- **Alternates (if any)**
  - Up to 3–5 other candidate scripts (name + ID + sanitized path)

- **Quick excerpt**
  - A short excerpt from `scripts_sanitized` (first few lines/steps) to confirm it's the right script

## Confirmation step

After presenting the Script match report, **always** use `AskQuestion` to confirm the match before taking any further action. This applies even when confidence is High.

Present a single question with the following structure:

- **Prompt**: Include the script name, ID and enclosing folder, e.g.:
  `"Is this the correct script? — Script Name (ID: 123) in xml_parsed/scripts"`
- **Options**:
  - `yes` — "Yes, proceed"
  - `no` — "No, that's not it — let me clarify"

**If the user confirms (yes):**

- Proceed with the next action (handoff, review, refactor, etc.) as requested.
- If no fmxmlsnippet exists in `agent/scripts/` or `agent/sandbox/`, convert the Save-As-XML source using `agent/scripts/fm_xml_to_snippet.py` before proceeding.

**If the user declines (no):**

- Ask the user to provide a corrected script name or ID.
- Re-run the matching workflow with the new input.
- Do not proceed with any review, refactor, or conversion until confirmation is received.

## Handoff: when the user asked to "review" or "refactor"

If the user request is a review/refactor/optimization:

- Use this lookup to identify the correct script and its artifacts.
- Then follow the existing `script-review` workflow:
  - Prefer an existing fmxmlsnippet version in `agent/scripts/` or `agent/sandbox/` as the base.
  - If none exists, translate from Save-As-XML using `agent/scripts/fm_xml_to_snippet.py` (do not do a manual full conversion).

## Examples

### Example 1 — ID-based

User: "Review script ID 123"

- Perform an ID match.
- Output the Script match report.
- Use `AskQuestion`: "Is this the correct script? — Script Name (ID: 123)"
- On confirmation: proceed with `script-review`; convert via `fm_xml_to_snippet.py` if no fmxmlsnippet exists.

### Example 2 — Name-based

User: "I'd like to do a review of the New Invoice for Client script"

- Normalize name hint: "new invoice for client"
- Exact/contains/fuzzy match in `agent/xml_parsed/scripts_sanitized/`.
- Output the Script match report (include alternates if ambiguous).
- Use `AskQuestion`: "Is this the correct script? — New Invoice for Client (ID: 456)"
- On confirmation: proceed with `script-review`; convert via `fm_xml_to_snippet.py` if no fmxmlsnippet exists.

### Example 3 — Ambiguous name

User: "Show me the invoice script"

- Fuzzy match, pick the best candidate.
- Include alternates prominently in the report.
- Use `AskQuestion` to confirm the best candidate before proceeding.
