# BE Plugin — Zip and Gzip

Create and extract zip archives and gzip-compressed data.

**Platform:** All platforms.

---

## Gzip (single file/stream compression)

### BE_Gzip ( data ; { filename } )
- **Returns:** Gzip-compressed container data
- **Params:** `data` (container or text) — data to compress | `filename` (text, optional) — output filename (`.gzip` appended)
- **Notes:** Use with `Set Field` to store in a container. **Not the same as `BE_ContainerCompress`** — this creates a standard gzip file; `BE_ContainerCompress` operates on FileMaker's internal container storage.

### BE_UnGzip ( gzip_data ; { filename } )
- **Returns:** Decompressed container or text data
- **Params:** `gzip_data` (container) — gzipped data | `filename` (text, optional) — output filename
- **Notes:** For container results, use with `Set Field`. For text results, can be used inline in calculations.

---

## Zip (multi-file archives)

### BE_Zip ( filePathList ; { archiveFilePath } )
- **Returns:** 0 on success
- **Params:** `filePathList` (text or container) — ¶-separated OS paths, or a container | `archiveFilePath` (text, optional) — OS path for the zip output
- **Notes:** If no `archiveFilePath`, the zip is created in the same folder as the first file. **Zip format does not support two files with the same name** — the second overwrites the first when unzipping. Container field support added in v4.2.0.

### BE_Unzip ( archiveFilePath ; { outputFolderPath } )
- **Returns:** 0 on success; files extracted to output folder
- **Params:** `archiveFilePath` (text or container) — OS path or container | `outputFolderPath` (text, optional, default: same folder as zip)
- **Notes:** Overwrites existing files with the same names. Container support added in v4.2.0.

---

## Example: zip multiple files

```
Set Variable [ $fileList ; Value: "/tmp/report.pdf¶/tmp/data.csv" ]
Set Variable [ $~ ; Value: BE_Zip ( $fileList ; "/tmp/export.zip" ) ]
Set Variable [ $err ; Value: BE_GetLastError ]
```

## Example: unzip to a specific folder

```
Set Variable [ $~ ; Value: BE_Unzip ( "/tmp/archive.zip" ; "/tmp/extracted/" ) ]
```
