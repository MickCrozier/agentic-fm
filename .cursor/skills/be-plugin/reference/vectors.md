# BE Plugin — Vectors

Mathematical vector operations on ¶-separated number lists. Primarily useful for AI/ML similarity calculations (e.g. comparing embedding vectors).

**Platform:** All platforms.

---

### BE_VectorDotProduct ( a ; b )
- **Returns:** Scalar dot product of two vectors
- **Params:** `a` (text) — ¶-separated list of numbers | `b` (text) — ¶-separated list of numbers
- **Notes:** Vectors must have the same number of elements. `BE_VectorDotProduct ( "1¶3¶-5" ; "4¶-2¶-1" )` returns `3`.

### BE_VectorEuclideanDistance ( a ; b )
- **Returns:** Euclidean (straight-line) distance between two points
- **Params:** `a` (text) — ¶-separated list of numbers | `b` (text) — ¶-separated list of numbers
- **Notes:** Useful for measuring similarity between AI embedding vectors — smaller distance = more similar. `BE_VectorEuclideanDistance ( "1¶3¶-5" ; "4¶-2¶-1" )` returns approximately `7.07107`.

---

## Example: compare two text embeddings for similarity

```
// $vecA and $vecB are ¶-separated embedding vectors from an AI API
Set Variable [ $distance ; Value: BE_VectorEuclideanDistance ( $vecA ; $vecB ) ]
// Lower $distance = more semantically similar
```
