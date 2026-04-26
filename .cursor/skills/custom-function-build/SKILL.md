---
name: custom-function-build
description: Create a new FileMaker custom function and deploy it to the clipboard for pasting into Manage Custom Functions. Use when the developer asks to create, add, or write a custom function. Produces fmxmlsnippet XML with the XMFN clipboard class.
---

# Custom Function Build

Generate a FileMaker custom function as `fmxmlsnippet type="FMObjectList"` with `<CustomFunction>` as the root element. Deploy via `clipboard.py` (auto-detects `XMFN`).

---

## Step 1: Gather context

Before writing, check whether the function already exists:

```bash
grep -r "name=\"FunctionName\"" agent/xml_parsed/custom_function_calcs/*/
```

Also check `agent/CONTEXT.json` → `custom_functions` section if present. If the function exists, read it and modify rather than creating from scratch.

---

## Step 2: Write the XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<fmxmlsnippet type="FMObjectList">
  <CustomFunction id="0" functionArity="N" visible="True" parameters="param1 ; param2" name="FunctionName">
    <Calculation><![CDATA[
...calculation body...
    ]]></Calculation>
  </CustomFunction>
</fmxmlsnippet>
```

### Attribute rules

| Attribute       | Value                                                                                 |
|-----------------|---------------------------------------------------------------------------------------|
| `id`            | Use `0` — FileMaker auto-assigns on paste                                             |
| `functionArity` | Number of parameters (0 for no params)                                                |
| `visible`       | `"True"` = public (callable from any calculation); `"False"` = private               |
| `parameters`    | Parameter names separated by ` ; ` (space-semicolon-space). Empty string if no params |
| `name`          | The function name exactly as it will appear in FileMaker                              |

### Calculation body rules

- Wrap in `<![CDATA[...]]>` — no XML escaping needed inside
- Use FileMaker native functions and operators
- Parameter names in the body must match the `parameters` attribute exactly
- Recursive functions reference themselves by name — FileMaker supports recursion natively
- Follow `agent/docs/CODING_CONVENTIONS.md` — Let() formatting, operator spacing, etc.
- Never invent function names — validate against `agent/docs/filemaker/functions/` if available

### Common patterns

**No parameters (constant):**
```xml
<CustomFunction id="0" functionArity="0" visible="True" parameters="" name="AppVersion">
  <Calculation><![CDATA["2.1.0"]]></Calculation>
</CustomFunction>
```

**Single parameter:**
```xml
<CustomFunction id="0" functionArity="1" visible="True" parameters="n" name="NumToLetter">
  <Calculation><![CDATA[Char ( 64 + n )]]></Calculation>
</CustomFunction>
```

**Multiple parameters:**
```xml
<CustomFunction id="0" functionArity="2" visible="True" parameters="value ; decimals" name="RoundTo">
  <Calculation><![CDATA[Round ( value ; decimals )]]></Calculation>
</CustomFunction>
```

**Recursive (e.g. extended alpha — 27→AA, 28→AB…):**
```xml
<CustomFunction id="0" functionArity="1" visible="True" parameters="n" name="NumToLetterExt">
  <Calculation><![CDATA[
If ( n <= 26 ;
	Char ( 64 + n ) ;
	NumToLetterExt ( Ceiling ( n / 26 ) - 1 ) & Char ( 64 + Mod ( n - 1 ; 26 ) + 1 )
)
  ]]></Calculation>
</CustomFunction>
```

---

## Step 3: Deploy

Write the XML to `agent/sandbox/{FunctionName}.xml`, then copy to clipboard:

```bash
python3 agent/scripts/clipboard.py write agent/sandbox/FunctionName.xml
```

`clipboard.py` auto-detects `XMFN` from the `<CustomFunction>` element — no `--class` flag needed.

### Paste instructions

> The custom function is on your clipboard.
>
> 1. Open **File > Manage > Custom Functions**
> 2. Click **Import** (or **⌘V** if FM supports direct paste — varies by version)
> 3. If paste doesn't work, click **New**, name it **{FunctionName}**, paste the calculation body manually

> **Note:** FileMaker 19+ supports pasting `<CustomFunction>` snippets directly into the Manage Custom Functions dialog via ⌘V. Earlier versions require manual entry.

---

## Constraints

- One `<CustomFunction>` element per snippet — FM only pastes the first if multiple are present
- `functionArity` must exactly match the number of parameters in the `parameters` attribute
- Private functions (`visible="False"`) are not callable from layout calculations or scripts — only from other custom functions
- Custom function names are global across the file — check for conflicts before creating
- Never modify files in `agent/xml_parsed/` — copy to `agent/sandbox/` first
