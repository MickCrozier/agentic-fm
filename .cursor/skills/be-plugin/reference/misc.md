# BE Plugin — Miscellaneous

Shell execution, regex, FileMaker SQL, script execution, encoding, and plugin version/utility functions.

---

### BE_ExecuteSystemCommand ( command ; { timeout ; executeUsingShell } )
- **Returns:** stdout output from the command
- **Params:** `command` (text) — shell command | `timeout` (integer, optional) — milliseconds to wait (0=return immediately, empty=wait forever) | `executeUsingShell` (boolean, optional, default: True)
- **Notes:** **Does NOT behave identically to an interactive Terminal/CMD.** Working directory, user, environment variables, and PATH may all differ. On FMS runs as the `fmserver` user. On Windows, pipe character `|` does not work. Multiple commands on Mac: separate with `Char(10)` (when `executeUsingShell=True`). Only captures stdout — stderr is not returned. Renamed from `BE_ExecuteShellCommand` (removed v3.0.0).
- **Platform:** All platforms

### BE_EvaluateJavaScript ( javaScript )
- **Returns:** Result of the JavaScript expression, if any
- **Params:** `javaScript` (text) — JavaScript code to evaluate
- **Notes:** Status is **Testing** — may change or be removed. Uses Duktape library. Callbacks available: `BE_Evaluate_FileMaker_Calculation()` and `BE_ExecuteScript()` can be called from within the JS.
- **Platform:** Mac FMP ✓ / Win FMP ✓ / FMS ✗ / iOS ✗ / Linux ✗

### BE_FileMakerSQL ( sqlStatement ; { columnSeparator ; rowSeparator ; databaseName ; asText ; outputPath } )
- **Returns:** Query result as text (or container for container fields when `asText=False`)
- **Params:** `sqlStatement` (text) | `columnSeparator` (text, optional) — single character | `rowSeparator` (text, optional) — single character | `databaseName` (text, optional) — open FM database name (default: current) | `asText` (boolean, optional, default: True) | `outputPath` (text, optional) — OS path to write results to disk
- **Notes:** Performs SQL against FileMaker table occurrences. When `asText=False`, limited to a single container field at a time. Check `BE_GetLastDDLError` for DDL errors.
- **Platform:** All platforms

### BE_RegularExpression ( text ; expression ; { options ; replaceString } )
- **Returns:** First matched text, or result of replace operation (when `replaceString` provided)
- **Params:** `text` (text) | `expression` (text) — PCRE regular expression | `options` (text, optional) — flag characters | `replaceString` (text, optional) — replacement makes this a replace operation
- **Notes:** Perl-Compatible Regular Expressions (PCRE). Options: `i`=case-insensitive, `m`=multiline, `s`=dot matches newline, `x`=ignore whitespace, `g`=replace all, `v`=iterate over value list (apply expression to each value). Backslashes must be escaped in FM calculations: `"\\d"` for digit. Reference: http://perldoc.perl.org/perlre.html
- **Platform:** All platforms

### BE_ScriptExecute ( scriptName ; { fileName ; parameter ; scriptControl } )
- **Returns:** 0 on success
- **Params:** `scriptName` (text) | `fileName` (text, optional, default: current file) | `parameter` (text, optional) | `scriptControl` (integer, optional, default: 3/Pause) — 0=Halt, 1=Exit, 2=Resume, 3=Pause
- **Notes:** Script is queued and runs when the current script queue is empty — **not immediately**. Script results cannot be captured. **Bug:** filenames with more than one `.` in the name cause error 100.
- **Platform:** All platforms

### BE_ScriptStepInstall ( name ; definitionXML ; id ; description ; calculation )
- **Returns:** 0 on success
- **Params:** `name` (text) | `definitionXML` (text) — FM SDK script step XML | `id` (integer) — unique internal ID (cannot be reused once installed) | `description` (text) | `calculation` (text) — logic using `###0###`, `###1###` placeholders
- **Notes:** Creates a custom script step. XML follows FM SDK format with Calc/Bool/List/Target parameter types. Not available on FMS.
- **Platform:** Mac ✓ / Win ✓ / FMS ✗ / iOS ✓ / Linux ✓

### BE_ScriptStepPerform ( scriptStepId )
- **Returns:** 0 on success
- **Params:** `scriptStepId` (integer)
- **Notes:** Performs a custom step by ID.
- **Platform:** Mac ✓ / Win ✓ / FMS ✗ / iOS ✓ / Linux ✓

### BE_ScriptStepRemove ( scriptStepId )
- **Returns:** 0 on success
- **Params:** `scriptStepId` (integer)
- **Notes:** Removes the step definition from memory. No undo.
- **Platform:** Mac ✓ / Win ✓ / FMS ✗ / iOS ✓ / Linux ✓

### BE_SetTextEncoding ( { encoding } )
- **Returns:** 0 on success
- **Params:** `encoding` (text, optional, default: UTF-8) — iconv encoding name (e.g. `"UTF-16"`, `"ISO-8859-1"`)
- **Notes:** Affects all subsequent plugin text file read/write operations. No param or empty = reset to UTF-8. Does not convert between encodings — only sets how text is read/written. Full list: http://www.gnu.org/software/libiconv/ or run `iconv -l` in Terminal.
- **Platform:** All platforms

### BE_GetMachineName
- **Returns:** Computer name (`%COMPUTERNAME%` on Windows, hardware identifier on Mac)
- **Platform:** All platforms

### BE_GetSystemDrive
- **Returns:** System drive path — equivalent to `Get(SystemDrive)` but works on FMS
- **Platform:** All platforms

### BE_Pause ( milliseconds )
- **Returns:** 0 on success
- **Params:** `milliseconds` (integer)
- **Notes:** Blocks the running script for the specified time. Single-threaded — FM is unresponsive during the pause.
- **Platform:** All platforms

### BE_Version
- **Returns:** Plugin version as text (e.g. `"4.2.0"`)
- **Notes:** Do NOT use for version comparisons — `"1.9.0" < "1.10.0"` fails as text. Use `BE_VersionAutoUpdate` for numeric comparisons.
- **Platform:** All platforms

### BE_VersionAutoUpdate
- **Returns:** 8-digit version number (e.g. `04020400` for v4.2.4)
- **Notes:** Format: MMNNPPQQ. Use `GetAsNumber ( BE_VersionAutoUpdate ) ≥ GetAsNumber ( "04000000" )` for reliable version comparison.
- **Platform:** All platforms

---

## Common patterns

### Run a shell command (Mac)

```
Set Variable [ $output ; Value: BE_ExecuteSystemCommand ( "ls -la /tmp" ; 5000 ) ]
```

### Run AppleScript (Mac)

```
Set Variable [ $script ; Value: "tell application \"Finder\" to get name of front window" ]
Set Variable [ $result ; Value: BE_ExecuteSystemCommand ( "osascript -e " & Quote ( $script ) ; 10000 ) ]
```

### Regex find and replace

```
// Find first match
Set Variable [ $match ; Value: BE_RegularExpression ( $text ; "[0-9]+" ) ]

// Replace all numbers with X
Set Variable [ $replaced ; Value: BE_RegularExpression ( $text ; "[0-9]+" ; "g" ; "X" ) ]

// Case-insensitive replace
Set Variable [ $result ; Value: BE_RegularExpression ( $text ; "hello" ; "gi" ; "Hi" ) ]
```
