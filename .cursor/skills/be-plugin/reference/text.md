# BE Plugin — Text

Extended text manipulation functions.

**Platform:** All platforms.

---

### BE_TextExtractWords ( text ; { wordPrefix } )
- **Returns:** ¶-separated list of words beginning with the prefix character
- **Params:** `text` (text) — text to search | `wordPrefix` (text, optional, default: `$` or `@`) — single prefix character
- **Notes:** Word boundaries: ` ; + - = * / & ^ < > \ t \r [ ] ( ) ≠ ≤ ≥ ,` and space. Skips content inside FileMaker comments (`//` to end of line, `/* ... */`). Originally designed for extracting variable names from calculation text — useful for static analysis of FileMaker scripts.

---

## Example: extract all variables from a calculation

```
Set Variable [ $vars ; Value: BE_TextExtractWords ( $calcText ; "$" ) ]
// Returns: "$name¶$date¶$total" etc.
```
