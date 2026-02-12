# Overview

This project is designed to create FileMaker scripts in the clipboard supported format of fmxmlsnippets. The following folders are used.

- _sandbox_ is where all newly created scripts are stored
- _xml_parsed_ is the xml output from the FileMaker solution.
  - _scripts_ subfolder contains the xml details of scripts from the solution. NOTE: This xml is not the same as the fmxmlsnippet format. It has been output from the Save As XML option in FileMaker.
  - _scripts_sanitized_ subfolder is the human-readable text version of a script. Logic and flow can be referenced here.
- _snippet_examples_ is a reference folder where boilerplate xml can be referenced when needed.

# Output format

- Any code output, unless otherwise instructed, should be as XML in the fmxmlsnippet format.
- Output should contain ONLY script steps within the `<fmxmlsnippet type="FMObjectList">` wrapper - DO NOT wrap in `<Script>` tags.
- Examples of fmxmlsnippets can be referenced in the snippet_examples folder.
- Use the simplified fmxmlsnippet syntax for steps, NOT the verbose XML format found in xml_parsed/scripts.

# fmxmlsnippet details

- The id attribute of most tags can be 0. When pasting into FileMaker it will be auto-assigned.
- Certain script steps require a matching secondary step to be valid.
  - Examples are If[], End If and Open Transaction, Commit Transaction and others.
  - The snippet examples will include an XML note for the matching step and the XML note should not be included in any output code.
- Any xml comments within the snippet_examples should be referenced only and not included in code output.

# Script creation

A newly created script, in the fmxmlsnippet format, can use grep across the xml_parsed folder in order to lookup required associations or references in order to be completed.

**MANDATORY: Before writing ANY script step, you MUST:**

1. Use the Read tool to read the corresponding snippet_examples file for that step type
2. Copy the EXACT XML structure from the snippet_examples file
3. Only substitute the specific IDs/names/values as needed from xml_parsed lookups

# Lookup methodology

When creating scripts that reference FileMaker objects (layouts, fields, table occurrences, etc.), follow this two-part process:

**Part 1: READ snippet_examples for OUTPUT structure**

- snippet_examples contains the correct fmxmlsnippet syntax for script steps
- **ALWAYS use the Read tool to read the snippet_examples file for each step type**
- Use these as templates for the EXACT structure and attributes of each step
- These show the simplified format used in fmxmlsnippets (NOT the verbose xml_parsed format)
- **DO NOT guess, assume, or infer the XML structure - read the file!**

**Part 2: Use grep on xml_parsed for IDs and names**

- xml_parsed contains the actual IDs, names, and references from the FileMaker solution
- ALWAYS use grep to search xml_parsed rather than reading full file contents
- Extract ONLY the id and name attributes needed for references

**Required workflow:**

1. **READ the appropriate step template file from snippet_examples** - do NOT guess or infer the structure
2. Use grep to find the specific IDs and names from xml_parsed
3. Combine the exact structure (from snippet_examples file) with the correct IDs/names (from xml_parsed)
4. Never read entire files from xml_parsed unless absolutely necessary

**CRITICAL: You MUST read the actual snippet_examples file for EVERY step type used. Do NOT assume or remember the structure from previous conversations.**

**Examples:**

- **Field reference**:
  - Structure from: `snippet_examples/steps/fields/Set Field.xml`
  - IDs/names from: First locate layout: `grep -r "layout-name" xml_parsed/layouts/`, then search for field: `grep "FieldReference.*field-name" xml_parsed/layouts/path-to-layout.xml`
  - Extract: field id, field name, table name (not the full TableOccurrenceReference structure)
- **Layout reference**:
  - Structure from: `snippet_examples/steps/navigation/Go to Layout.xml`
  - IDs/names from: `grep -r "Layout.*name=\"layout-name\"" xml_parsed/layouts/` or `grep "^<Layout" xml_parsed/layouts/path-to-layout.xml`
  - Extract: layout id and name only

- **Script reference**:
  - Structure from: `snippet_examples/steps/control/Perform Script.xml`
  - IDs/names from: `grep -r "ScriptReference.*name=\"script-name\"" xml_parsed/scripts/`
  - Extract: script id and name only

**Key principle**: snippet_examples provides OUTPUT structure; xml_parsed provides reference IDs/names. Use grep for efficiency.

# Common mistakes to avoid

- ❌ Do NOT wrap output in `<Script>` tags - output steps only
- ❌ Do NOT copy verbose structures from xml_parsed/scripts - use snippet_examples
- ❌ Do NOT read full files when grep can extract the needed information
- ❌ Do NOT add features not explicitly requested by the user
- ❌ Do NOT guess or assume the XML structure - ALWAYS read the snippet_examples file first
- ❌ Do NOT use `<Calculation><![CDATA["text"]]></Calculation>` for comments - use `<Text>text</Text>` (check the snippet first!)

# Constraints

- XML within _xml_parsed_ is NEVER modified. It is only referenced!
- XML within the _snippet_examples_ should be prompted when being modifed. It is rarely updated.
