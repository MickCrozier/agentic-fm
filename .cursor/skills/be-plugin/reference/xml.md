# BE Plugin — XML, XSLT, and JSON

XPath querying, XSD validation, XSLT transforms, and a JSON array size utility.

**Platform:** All platforms.

---

## JSON

### BE_JSON_ArraySize ( json ; { path } )
- **Returns:** Number of elements in the JSON array
- **Params:** `json` (text) — JSON content | `path` (text, optional) — JSONPath to array within the JSON
- **Notes:** Without path: counts root array elements; returns 1 for non-array types. **Note:** BE JSONPath syntax differs from native FM JSON function dot notation. Most JSON work should use native FM JSON functions (FM 16+). This function fills the gap of counting array sizes without iterating.

---

## XML

### BE_XMLParse ( pathOrXMLText )
- **Returns:** Empty on success; check `BE_GetLastError`
- **Params:** `pathOrXMLText` (text) — XML text (auto-detected if starts with `<`) or OS path to XML file
- **Notes:** Checks well-formedness only — does **not** validate against a schema. Use `BE_XMLValidate` for schema validation.

### BE_XMLValidate ( xmlText ; schemaText )
- **Returns:** Empty on success; check `BE_GetLastError`
- **Params:** `xmlText` (text) — XML to validate | `schemaText` (text) — XSD schema content
- **Notes:** Full XSD schema validation beyond simple well-formedness.

### BE_XML_Canonical ( xml )
- **Returns:** Canonical XML text (C14N normalized form)
- **Params:** `xml` (text) — XML content
- **Notes:** Produces Canonical XML for reliable comparison and digital signing. See https://en.wikipedia.org/wiki/Canonical_XML

### BE_XMLTidy ( xml )
- **Returns:** Pretty-printed/indented XML text
- **Params:** `xml` (text) — XML content

### BE_XMLStripNodes ( inputFilePath ; outputFilePath ; nodeNames )
- **Returns:** 0 on success; output written to `outputFilePath`
- **Params:** `inputFilePath` (text) — OS path to input XML file | `outputFilePath` (text) — OS path for output | `nodeNames` (text) — space-separated list of node names to remove
- **Notes:** Useful for stripping verbose nodes from FileMaker DDR XML files (e.g. `"HexData PlatformData"`).

### BE_XMLStripInvalidCharacters ( path ; { resultFilePath } )
- **Returns:** 0 on success
- **Params:** `path` (text) — OS path to XML file | `resultFilePath` (text, optional) — output path (overwrites input if omitted)
- **Notes:** Removes characters that are invalid in XML 1.0. Primarily an internal developer utility.

---

## XPath

### BE_XPath ( xmlText ; xpathText ; { namespaceListText ; asTextBoolean } )
- **Returns:** First matching XPath node result
- **Params:** `xmlText` (text) — XML content | `xpathText` (text) — XPath 1.0 expression | `namespaceListText` (text, optional) — `"prefix1=href1 prefix2=href2"` | `asTextBoolean` (boolean, optional, default: False) — True returns inner text value instead of the node
- **Notes:** Uses libxml — **XPath 1.0 only** (not 2.0 or 3.0). For namespace-qualified XML you must supply the namespace mapping.

### BE_XPathAll ( xmlText ; xpathText ; { namespaceListText } )
- **Returns:** All matching nodes as text (¶-separated or as XML nodeset)
- **Params:** `xmlText` (text) | `xpathText` (text) | `namespaceListText` (text, optional)
- **Notes:** XPath 1.0 only. Supports XPATH_BOOLEAN, XPATH_NUMBER, and XPATH_STRING result types.

---

## XSLT

### BE_XSLTApply ( xmlFilePath ; xsltText ; outputFilePath ; { scriptName ; databaseName ; [ xsltText ; outputFilePath ] ... } )
- **Returns:** 0 on success; result(s) written to `outputFilePath`
- **Params:** `xmlFilePath` (text) — OS path to XML file | `xsltText` (text) — XSLT stylesheet | `outputFilePath` (text) — OS path for result | `scriptName` (text, optional) — script to call on completion (enables background threading) | `databaseName` (text, optional) | additional `xsltText + outputFilePath` pairs (optional) — for parallel transforms
- **Notes:** Add `scriptName` to run the transform in a background thread and return control to FM immediately. Add multiple xslt+path pairs to run multiple transforms simultaneously in parallel. Script parameter receives the function response or outputFilePath.

### BE_XSLT_ApplyInMemory ( xmlText ; xsltText )
- **Returns:** Transformed output as text
- **Params:** `xmlText` (text) — XML content | `xsltText` (text) — XSLT stylesheet
- **Notes:** In-memory text-to-text version of `BE_XSLTApply`. No file I/O required.

---

## Example: XPath query

```
Set Variable [ $result ; Value: BE_XPath (
	$xmlContent ;
	"//Order/Total/text()" ;
	"" ;        // no namespaces
	True        // return text value
) ]
```

## Example: namespace-aware XPath

```
Set Variable [ $result ; Value: BE_XPath (
	$xmlContent ;
	"//ns:Invoice/ns:Total" ;
	"ns=http://schemas.example.com/invoice"
) ]
```
