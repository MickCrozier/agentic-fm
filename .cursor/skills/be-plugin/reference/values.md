# BE Plugin — Value Lists

Extended functions for working with FileMaker ¶-separated value lists.

**Platform:** All platforms.

---

### BE_ValuesUnique ( listOfValues ; { caseSensitiveBoolean } )
- **Returns:** ¶-separated list with duplicates removed (first occurrence kept)
- **Params:** `listOfValues` (text) | `caseSensitiveBoolean` (boolean, optional, default: True)

### BE_ValuesFilterOut ( textToFilter ; filterValues ; { caseSensitiveBoolean } )
- **Returns:** ¶-separated list with `filterValues` items removed
- **Params:** `textToFilter` (text) — source list | `filterValues` (text) — items to remove | `caseSensitiveBoolean` (boolean, optional, default: True)
- **Notes:** Opposite of native `FilterValues`. `BE_ValuesFilterOut ( "a¶b¶c¶d" ; "b¶d" )` returns `"a¶c"`.

### BE_ValuesSort ( listOfValues ; { ascendingBoolean ; type } )
- **Returns:** Sorted ¶-separated list
- **Params:** `listOfValues` (text) | `ascendingBoolean` (boolean, optional, default: True) | `type` (integer, optional, default: 0) — 0=Text, 1=Numeric
- **Notes:** Sort order may differ from FileMaker's native field sort due to text encoding differences. This is by design, not a bug.

### BE_ValuesContainsDuplicates ( listOfValues ; { caseSensitiveBoolean } )
- **Returns:** True (1) if duplicates exist, False (0) otherwise
- **Params:** `listOfValues` (text) | `caseSensitiveBoolean` (boolean, optional, default: True)

### BE_ValuesTimesDuplicated ( listOfValues ; numberOfTimes )
- **Returns:** ¶-separated list of values that appear exactly `numberOfTimes` in the list
- **Params:** `listOfValues` (text) | `numberOfTimes` (integer)
- **Notes:** `BE_ValuesTimesDuplicated ( "a¶c¶c¶d¶d" ; 2 )` returns `"c¶d"`.

### BE_ValuesTrim ( listOfValues )
- **Returns:** ¶-separated list with leading/trailing whitespace trimmed from each value
- **Params:** `listOfValues` (text)
- **Notes:** Equivalent to applying native `Trim()` to each value individually and reassembling.

---

## Example: deduplicate and sort a list

```
Let ( [
	~unique = BE_ValuesUnique ( $rawList ; False ) ;  // case-insensitive
	~sorted = BE_ValuesSort ( ~unique ; 1 ; 0 )        // ascending text sort
] ;
	~sorted
)
```
