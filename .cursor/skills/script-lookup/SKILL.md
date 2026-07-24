---
name: script-lookup
description: Locate a specific FileMaker script by ID or name via the plugin, and pull its body into the sandbox as an editable working copy. Use when the user says "review/refactor/optimize/open/show" a script, mentions "script ID", or asks about a specific script by name.
---

# Script Lookup

Locate a FileMaker script by ID or name and pull its body into `agent/sandbox/{Solution}/` as an editable working copy. Optimized for minimum tool calls.

Everything goes through the plugin. If it is unreachable, there is no local copy of the solution to fall back to — say so and stop.

**Performance target**: 3 tool calls for ID-based lookups, 4 for name-based.

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

## Lookup workflow

### Step 1 — Find the script (PARALLEL)

Run these in **parallel** (single message, multiple tool calls):

**Tool call A — List scripts from live context:**

```bash
python3 agent/scripts/agfm_bridge.py context | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('solution:', d.get('solution'))
for name, info in sorted(d.get('scripts', {}).items()):
    print(f\"{info.get('id')}|{name}\")
"
```

- **ID-based**: filter the output for `{id}|`
- **Name-based**: filter for lines matching the name hint (case-insensitive)

If the script isn't in the context (it can be scoped narrowly), get the full roster from discovery:

```bash
python3 agent/scripts/agfm_bridge.py discovery-query scripts
```

If discovery isn't loaded, load it once: `python3 agent/scripts/agfm_bridge.py save-as-xml --load`

**Tool call B — List sandbox:**

- `ls agent/sandbox/{Solution}/` — check for an existing working copy (in-progress work).

### Step 2 — Pull the script body

Once you have the name, pull the body directly — no file paths to resolve:

```bash
python3 agent/scripts/agfm_bridge.py discovery-query script_body --script "{Script Name}"
```

If discovery is not loaded, navigate and read instead:

```bash
python3 agent/scripts/agfm_bridge.py fetch-script "{Script Name}"
```

To locate which file and folder a script lives in (useful for multi-file solutions):

```bash
python3 agent/scripts/agfm_bridge.py discovery-query script_locate --script "{Script Name}"
```

**Multi-file handling**: If `script_locate` shows the script lives in a different file than the frontmost one, tell the developer — they may need to bring that file to the front before you can deploy changes to it.

**Sandbox match**: From the Step 1B listing, check whether a working copy already exists for this script (match by name).

For **name-based lookups** where multiple scripts matched, pick the best candidate using the matching rules below, then pull that one.

### Step 3 — Script match report + confirmation

Present the report and confirm in one response:

**Selected script**
- Name: `{script name}`
- ID: `{id}`
- File / folder: `{from script_locate, or "current file"}`
- Confidence: High/Medium/Low (why)

**Working copy**
- Existing sandbox file: `{path in agent/sandbox/{Solution}/, or "none — will create"}`

**Alternates (if any)**
- Up to 3–5 other candidate scripts (name + ID)

**Quick excerpt**
- First few lines of the script body to confirm identity

Then use `AskUserQuestion`: "Is this the correct script? — {Script Name} (ID: {id}) in {solution}"
- Options: `yes` — "Yes, proceed" / `no` — "No, that's not it — let me clarify"

### Step 4 — Post-confirmation

**If confirmed:**

- If a working copy already exists in `agent/sandbox/{Solution}/`, use it as the editable base. Confirm with the developer that it is still current — the script may have changed in FileMaker since.
- If none exists, write the pulled body to `agent/sandbox/{Solution}/{ScriptName}.fmscript`.
- Proceed with the next action (handoff to review/refactor, or simply present the script).

**If declined:**

- Ask for a corrected script name or ID.
- Re-run from Step 1.

## Name-based matching rules

When the lookup returns multiple candidates, rank them:

1. **Exact name match** (case-insensitive) — highest confidence
2. **Contains match** (all tokens from the hint present in the candidate name)
3. **Fuzzy match** (most tokens match) — pick the best, include alternates in report

Pick the best candidate and continue. The confirmation step is the redirect gate — don't block on a separate disambiguation question unless confidence is truly Low across all candidates.

When ID and name conflict, **trust the ID**.

## Free-text search

When the developer describes a script by what it *does* rather than its name:

```bash
python3 agent/scripts/agfm_bridge.py discovery-query text_search --text "{term}"
```

This searches entity names and bodies across the whole solution — useful for "the script that emails invoices" style requests.

## If the plugin is unreachable

Report it plainly and stop:

> I can't reach the agentic-fm plugin, so I can't look up scripts in your solution. Could you check it's running? Then I'll pick this straight back up.

Do not guess at script IDs, invent a body, or offer to work from memory of an earlier session.

## Handoff: when the user asked to "review" or "refactor"

If the user request is a review/refactor/optimization:

- Use this lookup to identify the correct script and pull its body.
- Then follow the `script-review` or `script-refactor` workflow, using the sandbox working copy as the base.

## Examples

### Example 1 — ID-based lookup (fast path)

User: "Lets work on script 104"

**Step 1 (parallel):**
- Context: script list → `104|Quick Find Clients` in `Invoice Solution`
- List: `ls agent/sandbox/"Invoice Solution"/` → check for an existing working copy

**Step 2:** `discovery-query script_body --script "Quick Find Clients"`

**Step 3:** Report + confirm → "Is this the correct script? — Quick Find Clients (ID: 104) in Invoice Solution"

**Step 4:** On confirmation → write to `agent/sandbox/Invoice Solution/Quick Find Clients.fmscript`

**Tool calls: 3** (2 parallel + 1 body pull; confirm rides along with the report)

### Example 2 — Name-based lookup (fuzzy)

User: "Let's work on the invoices quick find for the invoice solution"

**Step 1 (parallel):** context script list → multiple matches:
- `104|Quick Find Clients`
- `106|Quick Find Invoices`
- `108|Quick Find Products`
- `110|Quick Find Staff`

Best match: "Quick Find Invoices" (contains the "invoices" token from the hint).

**Step 2:** Pull the body for "Quick Find Invoices".

**Step 3:** Report with alternates (104, 108, 110) + confirm.

**Step 4:** Write the working copy on confirmation.

**Tool calls: 4**

### Example 3 — Script not in the current context

User: "Review the New Invoice script"

The layout-scoped context doesn't include it. Run `discovery-query scripts` for the full roster (loading discovery first if needed), then continue from Step 2.

### Example 4 — Ambiguous name

User: "Show me the invoice script"

**Step 1 (parallel):** many matches in the script list.

Pick the best candidate, include alternates prominently. The confirmation step acts as the redirect gate.
