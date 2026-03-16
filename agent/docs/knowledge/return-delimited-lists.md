# Return-Delimited Lists — Searching and Manipulation

## Overview

Many FileMaker functions return return-delimited (¶-separated) lists:

| Function                              | Returns                         |
| ------------------------------------- | ------------------------------- |
| `ScriptNames ( "" )`                  | All script names in the file    |
| `LayoutNames ( "" )`                  | All layout names                |
| `FieldNames ( table ; layout )`       | Field names for a table/layout  |
| `TableNames ( "" )`                   | All table names                 |
| `ValueListItems ( file ; valueList )` | Items in a value list           |
| `List ( field )`                      | Field values across a found set |

Searching these lists correctly requires understanding a common boundary bug.

---

## The boundary bug

The naive existence check:

```
Position ( ScriptNames ( "" ) ; ¶ & $name & ¶ ; 1 ; 1 )
```

**silently fails** for the first and last items in any list — they have no surrounding ¶ on their exposed edges.

### The fix — wrap the list

```
Position ( ¶ & ScriptNames ( "" ) & ¶ ; ¶ & $name & ¶ ; 1 ; 1 )
```

This guarantees every item is bounded by ¶ on both sides, regardless of position. Apply this pattern to any return-delimited list from any source.

---

## Preferred approach — `ValueExists()` custom function

When the solution includes the `ValueExists` custom function, prefer it over inline `Position`. It combines the wrapped `Position` pattern with a faster `FilterValues` path for non-empty values, and handles the NULL string edge case:

```
ValueExists ( $name ; ScriptNames ( "" ) )
// Returns True (1) if found, False (0) if not
```

`ValueExists` signature: `ValueExists ( searchValue ; referenceList )`

Use `ValueExists` whenever checking membership in any return-delimited list. Avoid reimplementing the Position pattern inline when this function is available.

---

## Correct guard pattern (without `ValueExists`)

```
If [ not Position ( ¶ & ScriptNames ( "" ) & ¶ ; ¶ & $name & ¶ ; 1 ; 1 ) ]
  // name not found — handle error
End If
```

---

## Related custom functions

These functions extend FileMaker's native list capabilities and are commonly available in solutions using the standard custom function library:

| Function                                                         | Purpose                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `ValueExists ( searchValue ; referenceList )`                    | True/False membership test — preferred over inline Position          |
| `ValuePosition ( valueList ; searchValue ; start ; occurrence )` | Like `Position()` but counts by value number, not character position |
| `ValueToggle ( listOfValues ; valueToToggle )`                   | Adds the value if absent, removes all instances if present           |
| `ValuesWrap ( values ; prefix ; suffix )`                        | Wraps each item with a prefix and suffix                             |
| `ValueExtract ( data ; start ; end )`                            | Extracts text between two markers                                    |

---

## References

| Name           | Type     | Local doc                                                 | Claris help                                                                       |
| -------------- | -------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Position       | function | `agent/docs/filemaker/functions/text/position.md`         | [position](https://help.claris.com/en/pro-help/content/position.html)             |
| FilterValues   | function | `agent/docs/filemaker/functions/text/filtervalues.md`     | [filtervalues](https://help.claris.com/en/pro-help/content/filtervalues.html)     |
| ScriptNames    | function | `agent/docs/filemaker/functions/get/scriptnames.md`       | [scriptnames](https://help.claris.com/en/pro-help/content/scriptnames.html)       |
| LayoutNames    | function | `agent/docs/filemaker/functions/get/layoutnames.md`       | [layoutnames](https://help.claris.com/en/pro-help/content/layoutnames.html)       |
| FieldNames     | function | `agent/docs/filemaker/functions/design/fieldnames.md`     | [fieldnames](https://help.claris.com/en/pro-help/content/fieldnames.html)         |
| ValueListItems | function | `agent/docs/filemaker/functions/design/valuelistitems.md` | [valuelistitems](https://help.claris.com/en/pro-help/content/valuelistitems.html) |
