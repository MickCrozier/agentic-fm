# BE Plugin — Containers

Functions for compressing, converting, exporting, importing, and inspecting container field data.

**Platform:** All platforms unless noted.

---

### BE_ContainerCompress ( data ; { filename } )
- **Returns:** Compressed container data (gzip format)
- **Params:** `data` (container) | `filename` (text, optional) — filename for result container
- **Notes:** Internal FM-level compression only — does not change visible content. Without filename, the plugin attempts to return text which usually fails. Was named `BE_Gzip` before v3.2.0. Different from `BE_Gzip` in the Zip/Gzip category.

### BE_ContainerUncompress ( gzip_data ; { filename } )
- **Returns:** Uncompressed container data
- **Params:** `gzip_data` (container) | `filename` (text, optional)
- **Notes:** Reverses `BE_ContainerCompress`. Was named `BE_UnGzip` before v3.2.0.

### BE_ContainerIsCompressed ( containerField )
- **Returns:** True (1) or False (0)
- **Params:** `containerField` (container)
- **Notes:** Tests whether a container was stored using FileMaker's built-in "compress" option at insert time.

### BE_ContainerListTypes ( container )
- **Returns:** ¶-separated list of internal FileMaker container type codes
- **Params:** `container` (container)
- **Notes:** Common types: `FILE`, `JPEG`. Types vary by FM version and storage method. Use with `BE_ContainerGetType` to retrieve a specific format.

### BE_ContainerGetType ( container ; type )
- **Returns:** Container data in the specified internal type
- **Params:** `container` (container) | `type` (text) — type code from `BE_ContainerListTypes`
- **Notes:** If a PDF is stored, requesting `JPEG` often returns the first page as JPEG. Type must exist in the container or returns empty.

### BE_ConvertContainer ( field ; { type } )
- **Returns:** Container data converted between file and image representation
- **Params:** `field` (container) | `type` (text, optional) — target type: empty=`FILE`, `JPEG`, `PNGf`, `PDF ` (note trailing space), `GIFf`, `BMPf`, `ZLIB`, `snd `, `EPS `, `META`
- **Notes:** **NOT** an image format converter — cannot convert PNG to JPEG. Only toggles FileMaker's internal "file" vs "image" container representation. All type codes are exactly 4 characters. Use with `Set Field`. Simplified in v4.2.0 (removed width/height params).

### BE_ExportFieldContents ( field ; { outputPath } )
- **Returns:** Path to the written file (when outputPath omitted, writes to OS temp and returns path)
- **Params:** `field` (container) | `outputPath` (text, optional) — OS path for output
- **Notes:** Similar to `Export Field Contents` script step but works on FileMaker Server. Creates intermediate directories as needed.

### BE_FileImport ( filePath ; { compressBoolean } )
- **Returns:** Container data with file contents
- **Params:** `filePath` (text) — OS path to file | `compressBoolean` (boolean, optional, default: True)
- **Notes:** Similar to `Insert File` script step but works on FileMaker Server. Use with `Set Field`. Convert result with `BE_ConvertContainer` if you need the file to display as an image.

### BE_JPEGRecompress ( jpeg ; { compressionLevel ; scale } )
- **Returns:** Recompressed JPEG container data
- **Params:** `jpeg` (container) — JPEG in container field | `compressionLevel` (integer, optional, default: 75) — 1–100 | `scale` (number, optional, default: 0.125) — scaling factor
- **Notes:** Scale values must be from the fixed set: 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.125, … 2. Other values round down to the nearest valid value. Use with `Set Field`. Can target the same field as source.
