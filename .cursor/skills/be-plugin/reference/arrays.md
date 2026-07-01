# BE Plugin — Arrays

Arrays are stored in plugin memory and referenced by an integer index returned from `BE_ArraySetFromValueList`. By default, empty values are stripped from the source value list before storage.

**Note:** Arrays are stored per-plugin-instance — they persist across scripts within the same FM session but do not persist across file close/reopen.

---

### BE_ArraySetFromValueList ( valueList ; { retainEmptyValues } )
- **Returns:** Integer index number for the stored array
- **Params:** `valueList` (text, ¶-separated) | `retainEmptyValues` (boolean, optional, default: False)
- **Notes:** Default strips empty values — `"a¶¶b¶"` becomes `[a, b]`. Set `retainEmptyValues` to True to match native FileMaker value list behavior. Store the returned index in a variable to pass to other array functions.

### BE_ArrayGetValue ( array ; valueNumber )
- **Returns:** The value at the specified 1-based index position
- **Params:** `array` (integer) — index from `BE_ArraySetFromValueList` | `valueNumber` (integer) — 1-based position
- **Notes:** Use `BE_ArrayGetSize` first to check bounds; out-of-range returns empty.

### BE_ArrayGetSize ( array )
- **Returns:** Number of elements in the array
- **Params:** `array` (integer) — index from `BE_ArraySetFromValueList`
- **Notes:** Equivalent to `ValueCount` on the original list (with default empty-stripping behavior).

### BE_ArrayFind ( array ; value )
- **Returns:** Element number (1-based position) of first match, or empty if not found
- **Params:** `array` (integer) | `value` (text) — value to find
- **Notes:** Searches from element 1 upward. Case-sensitive.

### BE_ArrayChangeValue ( array ; valueNumber ; newValue )
- **Returns:** 0 on success
- **Params:** `array` (integer) | `valueNumber` (integer) — 1-based position to change | `newValue` (text)
- **Notes:** Modifies the array in-place. Check `BE_GetLastError` for bounds errors.

### BE_ArrayDelete ( array )
- **Returns:** 0 on success
- **Params:** `array` (integer) — array index to delete
- **Notes:** **BUG (current release):** Deleting an earlier array shuffles the index numbers of later arrays, causing incorrect lookups. Avoid deleting arrays when multiple arrays are in use simultaneously. No undo.

---

## Example

```
Set Variable [ $arr ; Value: BE_ArraySetFromValueList ( $myList ) ]
Set Variable [ $count ; Value: BE_ArrayGetSize ( $arr ) ]
Set Variable [ $first ; Value: BE_ArrayGetValue ( $arr ; 1 ) ]
Set Variable [ $pos ; Value: BE_ArrayFind ( $arr ; "needle" ) ]
```
