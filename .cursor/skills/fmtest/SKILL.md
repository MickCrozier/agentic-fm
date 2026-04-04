---
name: fmtest
description: Generate FileMaker test scripts using the FMTest Add-on framework. Covers TEST scripts (individual custom function or script tests) and TESTSUITE scripts (orchestrators that call multiple TEST scripts and collect results). Understands the full FMTest API — assertion functions, $$FMT state, output buffers, and result retrieval. Triggers on phrases like "write a test", "test this function", "test this script", "FMTest", "create a test suite", "assert results", or "unit test".
---

# FMTest — FileMaker Unit Test Skill

Generate FileMaker test scripts using the FMTest Add-on framework. FMTest stores all state in `$$FMT` (a JSON global) and exposes a structured API of custom functions for asserting, describing, and reporting test results.

---

## FMTest prerequisite

FMTest must be installed as an Add-on in the target FileMaker solution. The Add-on provides:
- 30 custom functions (all prefixed `FMT.` or `Abbreviate_FMT`)
- 6 framework scripts (`FMT:Reset`, `FMT:WriteOutputBuffers`, `FMT:TEST_Framwework`, etc.)
- A `FMT` table with `Output` and `SummaryOutput` fields (written by `FMT:WriteOutputBuffers`)

If FMTest is not yet installed, direct the developer to install the Add-on before proceeding.

---

## $$FMT structure

All test state is stored in the `$$FMT` global JSON variable. Its schema:

```
$$FMT {
  suiteScriptName       // name of the suite script
  startTime             // Get(CurrentTimeUTCMilliseconds)
  endTIme               // (note: typo in source) end UTC ms
  totalTime             // elapsed ms
  result                // Boolean — overall pass/fail
  resultText            // "PASS" or "FAIL"
  assertionCount
  assertionPassCount
  assertionFailCount
  testCount
  testPassCount
  testFailCount
  scriptCount
  scriptPassCount
  scriptFailCount
  scripts []
    scriptName
    result              // Boolean
    assertionCount / assertionPassCount / assertionFailCount
    testCount / testPassCount / testFailCount
    tests []
      description
      result            // Boolean
      assertionCount / assertionPassCount / assertionFailCount
      assertions []
        result          // Boolean
        description     // "thing should equal expected"
        failText        // "got actualValue" — only populated on failure
```

**Key constraint**: `failText` (the actual value) is only stored when an assertion *fails*. Passing assertions carry no actual value — just `result: true`.

---

## FMTest API reference

### Lifecycle functions (called via Set Variable [ $~ ; ... ])

| Function | Signature | Returns | Purpose |
|---|---|---|---|
| `FMT.Reset` | `FMT.Reset` | `$$FMT` (cleared) | Clears all `$$FMT*` globals |
| `FMT.InitTestSuite` | `FMT.InitTestSuite` | `$$FMT` | Call at start of a TESTSUITE script — records suite name + startTime |
| `FMT.InitTestScript` | `FMT.InitTestScript` | script object | Call at start of each TEST script — adds a new script entry to `$$FMT` |
| `FMT.DescribeTest` | `FMT.DescribeTest ( description )` | test object | Opens a new test group within the current TEST script |
| `FMT.ConcludeTestScript` | `FMT.ConcludeTestScript` | script object | Finalizes the TEST script — appends summary output |
| `FMT.ConcludeTestSuite` | `FMT.ConcludeTestSuite` | `$$FMT` | Finalizes the suite — records endTime, totalTime |

### Assertion functions (called via Set Variable [ $~ ; ... ])

All assertions: `describe_thing` is a label for the value being tested (shown in output). The assertion updates `$$FMT` and returns the assertion object.

| Function | Signature | Tests |
|---|---|---|
| `FMT.Assert.Equal` | `FMT.Assert.Equal ( describe_thing ; value ; expected_value )` | `value = expected_value` |
| `FMT.Assert.NotEqual` | `FMT.Assert.NotEqual ( describe_thing ; value ; expected_value )` | `value ≠ expected_value` |
| `FMT.Assert.GreaterThan` | `FMT.Assert.GreaterThan ( describe_thing ; value ; threshold )` | `value > threshold` |
| `FMT.Assert.LessThan` | `FMT.Assert.LessThan ( describe_thing ; value ; threshold )` | `value < threshold` |
| `FMT.Assert.IsEmpty` | `FMT.Assert.IsEmpty ( describe_thing ; value )` | `IsEmpty ( value )` |
| `FMT.Assert.NotIsEmpty` | `FMT.Assert.NotIsEmpty ( describe_thing ; value )` | `not IsEmpty ( value )` |
| `FMT.Assert.IsInList` | `FMT.Assert.IsInList ( describe_thing ; value ; theList )` | value appears in list |
| `FMT.Assert.HasJsonKey` | `FMT.Assert.HasJsonKey ( describe_thing ; json ; key )` | JSON key exists |

### Result retrieval functions

| Function | Returns |
|---|---|
| `FMT.GetLastAssertionResult` | Last individual assertion result from `$$FMT` |
| `FMT.GetLastTestResult` | Last `DescribeTest` group result |
| `FMT.GetLastTestScriptResult` | Last TEST script's result slice from `$$FMT` |
| `FMT.GetLastTestSuiteResult` | Top-level `$$FMT.result` Boolean |
| `FMT.GetOutputBuffer` | Returns and clears `$$FMT_OutputBuffer` (human-readable log) |
| `FMT.GetOutputSummaryBuffer` | Returns and clears summary buffer |

### Timing functions

| Function | Signature | Purpose |
|---|---|---|
| `FMT.StartTimer` | `FMT.StartTimer ( identifier )` | Records a start time keyed by identifier |
| `FMT.GetTimer` | `FMT.GetTimer ( identifier )` | Returns elapsed ms since `StartTimer` was called |

### Framework scripts

| Script | Purpose |
|---|---|
| `FMT:Reset` | Resets FMTest state — calls `FMT.Reset` |
| `FMT:WriteOutputBuffers` | Writes `$$FMT_OutputBuffer` → `FMT::Output` field and exits with `$$FMT` as script result |
| `FMT:TEST_Framwework` | Self-test of the FMTest framework (note: typo in script name) |

---

## Step 1: Identify what to test

Determine from the developer's request:

1. **What is being tested** — a custom function, a script, or a calculation expression
2. **Expected inputs and outputs** — use developer-provided examples, or derive from source code
3. **Test scope** — is this a single TEST script, or does it belong in a TESTSUITE?

If testing a custom function, read its definition:
- Check `agent/xml_parsed/custom_function_calcs/` or `agent/xml_parsed/custom_functions_sanitized/`
- Or extract from the Add-on's `template.xml` if it's a FMTest-provided function

If testing a FileMaker script, use `script-lookup` to read the sanitized source.

---

## Step 2: Design test cases

Before writing XML, confirm the test cases with the developer (unless they've been fully specified already):

```
## Test plan: Abbreviate_FMT ( name ; numLetters )

### Group 1: Two words — "Complete Handover"
- numLetters = 1 → "C"
- numLetters = 2 → "CH"
- numLetters = 3 → "CoH"

### Group 2: Single word — "Hello"
- numLetters = 3 → "Hel"

### Group 3: Edge cases
- Empty string, numLetters = 3 → ""
```

Present the plan and wait for confirmation unless the developer has already provided the full expected-output table.

---

## Step 3: Determine the script pattern

### TEST script (standalone test)

Use for a focused test of one function or script. Naming convention: `TEST FunctionName` or `TEST ScriptName`.

```
Structure:
  Set Variable [ $~ ; FMT.InitTestScript ]

  # --- Group 1: description ---
  Set Variable [ $~ ; FMT.DescribeTest ( "description" ) ]
  Set Variable [ $~ ; FMT.Assert.Equal ( "label" ; actual ; expected ) ]
  ... (more assertions in this group)

  # --- Group 2: description ---
  Set Variable [ $~ ; FMT.DescribeTest ( "description" ) ]
  Set Variable [ $~ ; FMT.Assert.Equal ( "label" ; actual ; expected ) ]

  Set Variable [ $~ ; FMT.ConcludeTestScript ]
  Exit Script [ Result: FMT.GetLastTestScriptResult ]
```

### TESTSUITE script (orchestrator)

Use to run multiple TEST scripts together and collect a unified result. Naming convention: `TESTSUITE SuiteName`.

```
Structure:
  Set Variable [ $~ ; FMT.InitTestSuite ]

  Perform Script [ "TEST FunctionA" ]
  Perform Script [ "TEST FunctionB" ]
  Perform Script [ "TEST ScriptC" ]

  Set Variable [ $~ ; FMT.ConcludeTestSuite ]
  Exit Script [ Result: $$FMT ]
```

**OData constraint**: OData sessions are stateless — each script call runs in a fresh FM session where `$$FMT` is empty. To run tests via OData, the TESTSUITE must be a single entry point that performs all TEST scripts internally and returns `$$FMT` in one call. Never chain separate OData calls expecting `$$FMT` to persist between them.

---

## Step 4: Generate the fmxmlsnippet

### TEST script template

```xml
<?xml version="1.0" encoding="UTF-8"?>
<fmxmlsnippet type="FMObjectList">

	<Step enable="True" id="89" name="# (comment)">
		<Text>PURPOSE: Test [FunctionName/ScriptName]</Text>
	</Step>

	<Step enable="False" id="61" name="Insert Text">
		<SelectAll state="False"/>
		<Text>TEST [Name]&#xD;&#xD;[description of what is being tested]</Text>
		<Field>$README</Field>
	</Step>

	<Step enable="True" id="89" name="# (comment)"/>

	<Step enable="True" id="141" name="Set Variable">
		<Name>$~</Name>
		<Value>
			<Calculation><![CDATA[FMT.InitTestScript]]></Calculation>
		</Value>
	</Step>

	<Step enable="True" id="89" name="# (comment)"/>

	<Step enable="True" id="89" name="# (comment)">
		<Text>[Group description]</Text>
	</Step>

	<Step enable="True" id="141" name="Set Variable">
		<Name>$~</Name>
		<Value>
			<Calculation><![CDATA[FMT.DescribeTest ( "[test description]" )]]></Calculation>
		</Value>
	</Step>
	<Step enable="True" id="141" name="Set Variable">
		<Name>$~</Name>
		<Value>
			<Calculation><![CDATA[FMT.Assert.Equal (
	"[label for the value]" ;
	[actual expression] ;
	[expected value]
)]]></Calculation>
		</Value>
	</Step>

	<Step enable="True" id="89" name="# (comment)"/>

	<Step enable="True" id="141" name="Set Variable">
		<Name>$~</Name>
		<Value>
			<Calculation><![CDATA[FMT.ConcludeTestScript]]></Calculation>
		</Value>
	</Step>

	<Step enable="True" id="103" name="Exit Script">
		<Calculation><![CDATA[FMT.GetLastTestScriptResult]]></Calculation>
	</Step>

</fmxmlsnippet>
```

### TESTSUITE script template

```xml
<?xml version="1.0" encoding="UTF-8"?>
<fmxmlsnippet type="FMObjectList">

	<Step enable="True" id="89" name="# (comment)">
		<Text>PURPOSE: Run all [suite name] tests</Text>
	</Step>

	<Step enable="True" id="89" name="# (comment)"/>

	<Step enable="True" id="141" name="Set Variable">
		<Name>$~</Name>
		<Value>
			<Calculation><![CDATA[FMT.InitTestSuite]]></Calculation>
		</Value>
	</Step>

	<Step enable="True" id="89" name="# (comment)"/>

	<Step enable="True" id="6" name="Perform Script">
		<Script id="0" name="TEST [ScriptA]"/>
	</Step>
	<Step enable="True" id="6" name="Perform Script">
		<Script id="0" name="TEST [ScriptB]"/>
	</Step>

	<Step enable="True" id="89" name="# (comment)"/>

	<Step enable="True" id="141" name="Set Variable">
		<Name>$~</Name>
		<Value>
			<Calculation><![CDATA[FMT.ConcludeTestSuite]]></Calculation>
		</Value>
	</Step>

	<Step enable="True" id="103" name="Exit Script">
		<Calculation><![CDATA[$$FMT]]></Calculation>
	</Step>

</fmxmlsnippet>
```

### Coding notes

- Use `$~` as the throwaway variable for all FMT function calls — this is the FMTest convention. FMLint will warn about `N002` for this variable but it is intentional; ignore it.
- Use `FMT.Assert.IsEmpty` instead of `FMT.Assert.Equal ( ... ; "" )` for empty-value assertions.
- The `describe_thing` label in assertion functions should be a human-readable string identifying the actual value — e.g. `"Abbreviate_FMT ( \"Hello\" ; 3 )"`. This appears in the output log.
- Multi-line calculations inside `Set Variable` are fine — use tabs for indentation per CODING_CONVENTIONS.md.
- Use `# (comment)` blank steps between groups for readability.
- Do NOT use XML comments (`<!-- -->`); they are silently discarded by FileMaker.
- Resolve `Perform Script` IDs from CONTEXT.json or `scripts.index`. If IDs are unknown, use `id="0"` — FileMaker will assign on paste.

---

## Step 5: Validate

```bash
python3 -m agent.fmlint agent/sandbox/TEST\ [Name].xml
```

Expected warnings (intentional, do not fix):
- **N002** on `$~` — FMTest's conventional throwaway variable
- **C003** on `FMT.*` functions — custom functions unknown to the linter
- **C003** on the function under test — also a custom function

Fix any ERROR-level diagnostics before proceeding.

---

## Step 6: Deploy

```bash
python3 agent/scripts/clipboard.py write agent/sandbox/TEST\ [Name].xml
```

Then present to the developer:

> The script is on your clipboard. To install it:
>
> 1. Create a new script named **TEST [Name]** in Script Workspace
> 2. **⌘A** — select all existing steps and delete
> 3. **⌘V** — paste

---

## Step 7: Running tests and reading results

### Manually (Tier 1)

The developer runs the TEST or TESTSUITE script from Script Workspace. Results are visible in `$$FMT` in the Data Viewer, or written to `FMT::Output` after calling `FMT:WriteOutputBuffers`.

### Via OData (Tier 3)

Call the TESTSUITE (single entry point) via `AGFMScriptBridge`:

```
POST {odata.base_url}/{database}/Script.AGFMScriptBridge
Authorization: Basic ...
Content-Type: application/json

{ "scriptParameterValue": "{\"script\": \"TESTSUITE [Name]\"}" }
```

The `resultParameter` in the response will be the full `$$FMT` JSON.

Parse results:
- `$$FMT.result` — Boolean overall pass/fail
- `$$FMT.assertionPassCount` / `$$FMT.assertionFailCount` — totals
- `$$FMT.scripts[n].tests[m].assertions[k].failText` — "got [actualValue]" for each failing assertion

---

## Step 8: Interpreting results

Present a summary to the developer:

```
## Test Results: TEST Abbreviate_FMT

✅ 8/9 assertions passed

| Test | Assertion | Result | Notes |
|---|---|---|---|
| Two words: numLetters = 3 | CoH | PASS | |
| Two words: numLetters = 4 | CoHa | FAIL | got CoHab |
| Empty string | IsEmpty | PASS | |
```

For each failure, `$$FMT.scripts[n].tests[m].assertions[k].failText` contains `"got [actualValue]"`. Compare to the `description` field which contains `"[label] should equal [expected]"` to show expected vs actual.

If failures indicate a bug in the function under test, suggest using `script-debug` or raising with the developer.

---

## Constraints

- **FMTest is a read-only test framework** — test scripts must not modify production data. If testing a script with side effects, use test records or restore state after each test.
- **Each `FMT.DescribeTest` group is independent** — a failing group does not abort subsequent groups; all tests always run.
- **`$$FMT` does not persist across OData calls** — always use a single TESTSUITE as the OData entry point.
- **Script name conventions**: `TEST [name]` for individual test scripts, `TESTSUITE [name]` for suite orchestrators.
- **Do not call `FMT.InitTestSuite` inside a TEST script** — only TESTSUITE scripts call `InitTestSuite`. TEST scripts call `InitTestScript`.
