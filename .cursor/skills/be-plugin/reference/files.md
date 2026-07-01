# BE Plugin — Files and Folders

Read, write, move, copy, delete, and list files on the OS filesystem.

**Platform:** All platforms unless noted.

> **Path format:** All paths are OS-native paths — NOT FileMaker paths.
> - Mac: `/Users/name/Documents/file.txt`
> - Windows: `C:\Users\name\Documents\file.txt`
> - Never pass paths beginning with `file:/` or `filewin:/`

---

### BE_FileExists ( path )
- **Returns:** True (1) or False (0)
- **Params:** `path` (text) — OS path to file or folder
- **Notes:** Works for both files and folders.

### BE_FileReadText ( pathOrContainer ; { start ; to ; eolChar } )
- **Returns:** Text content of the file (or portion of it)
- **Params:** `pathOrContainer` (text or container) — path string or container | `start` (integer, optional) — 0-based start position | `to` (integer, optional) — end position | `eolChar` (text, optional) — character to treat as line delimiter
- **Notes:** First character is at position 0 (unlike native FileMaker `Position` which is 1-based). Pass `start` > `to` (or `start` empty) to read from the end backwards — useful for tailing logs. `eolChar` can be any character (even `,` for CSV column extraction) — the plugin does not convert it to FM line endings. Default encoding is UTF-8; change with `BE_SetTextEncoding`.

### BE_FileWriteText ( pathOrContainer ; text ; { appendBoolean } )
- **Returns:** 0 on success (or container data when writing to a container field)
- **Params:** `pathOrContainer` (text or container) — OS path, container file, or filename string | `text` (text) — content to write | `appendBoolean` (boolean, optional, default: False)
- **Notes:** Creates intermediate directories automatically. Default encoding UTF-8; change with `BE_SetTextEncoding`. When writing to a container field via `Set Field`: use just a filename string as `pathOrContainer` for a new file. Renamed from `BE_WriteTextToFile` in v4.0.2.

### BE_FilePatternCount ( path ; searchText )
- **Returns:** Integer count of occurrences (per value when `searchText` is a value list)
- **Params:** `path` (text) — OS path to text file | `searchText` (text or value list) — text to count
- **Notes:** Like native `PatternCount` but operates on a file on disk.

### BE_FileReplaceText ( pathOrContainer ; expression ; replaceString ; { options } )
- **Returns:** 0 on success
- **Params:** `pathOrContainer` (text or container) | `expression` (text) — PCRE regex pattern | `replaceString` (text) | `options` (text, optional, default: `"gi"`) — regex flags
- **Notes:** Option flags: `i`=case-insensitive, `m`=multiline, `s`=dot matches newline, `x`=ignore whitespace, `g`=replace all. Default `"gi"` matches native `Substitute` behavior. Modifies the file in-place on disk.

### BE_FileCopy ( fromFilePath ; toFilePath ; { replaceDestinationFile } )
- **Returns:** 0 on success
- **Params:** `fromFilePath` (text) | `toFilePath` (text) — destination path **including filename** | `replaceDestinationFile` (boolean, optional, default: False)
- **Notes:** `toFilePath` must include the desired filename, not just the folder. Can rename by using the same folder with a different filename. Supports copying directories. Renamed from `BE_CopyFiles` in v4.0.2.

### BE_FileMove ( fromFilePath ; toFilePath ; { replaceDestinationFile } )
- **Returns:** 0 on success
- **Params:** `fromFilePath` (text) | `toFilePath` (text) | `replaceDestinationFile` (boolean, optional, default: False)
- **Notes:** **Mac only:** move works within the same volume. For cross-volume moves, use `BE_FileCopy` + `BE_FileDelete`. Renamed from `BE_MoveFile` in v4.0.2.

### BE_FileDelete ( path )
- **Returns:** 0 on success
- **Params:** `path` (text) — OS path to file or folder
- **Notes:** **Permanent deletion — no trash or recycle bin.** Can delete folders and all contents recursively. No undo. Renamed from `BE_DeleteFile` in v4.0.2.

### BE_FileSize ( path )
- **Returns:** File size in bytes
- **Params:** `path` (text) — OS path to file

### BE_FileModificationTimestamp ( path )
- **Returns:** OS file modification timestamp (precision varies by OS, may include milliseconds)
- **Params:** `path` (text) — OS path to file
- **Notes:** Renamed from `BE_File_Modification_Timestamp` in v4.0.2.

### BE_FileOpen ( path )
- **Returns:** 0 on success (success = open request was sent, not that the file opened)
- **Params:** `path` (text) — OS path to file
- **Notes:** Opens using the default application. On Mac, the function confirms the open request was dispatched (asynchronous). Not available on iOS or Linux. Renamed from `BE_OpenFile` in v4.0.2.
- **Platform:** Mac ✓ / Win ✓ / FMS ✓ / iOS ✗ / Linux ✗

### BE_FileListFolder ( path ; { type ; includeSubdirBoolean ; useFullPathBoolean ; includeHiddenBoolean } )
- **Returns:** ¶-separated list of filenames or full paths
- **Params:** `path` (text) — OS folder path | `type` (constant, optional, default: `BE_FileTypeAll`) — `BE_FileTypeAll`, `BE_FileTypeFile`, or `BE_FileTypeFolder` | `includeSubdirBoolean` (boolean, optional, default: False) | `useFullPathBoolean` (boolean, optional, default: False) | `includeHiddenBoolean` (boolean, optional, default: False)
- **Notes:** `includeSubdirBoolean` can be slow and may return error 13 with no data on permission errors. Consider iterating sub-folders manually via script for better error handling.

### BE_FolderCreate ( path )
- **Returns:** 0 on success
- **Params:** `path` (text) — OS path for new folder
- **Notes:** Creates intermediate sub-folders recursively. Renamed from `BE_CreateFolder` in v4.0.2.

---

## Example: read first 20 lines of a log file

```
BE_FileReadText ( $logPath ; 0 ; 20 ; Char(10) )
```

## Example: write a new file

```
Set Variable [ $~ ; Value: BE_FileWriteText ( "/tmp/output.txt" ; $content ) ]
Set Variable [ $err ; Value: BE_GetLastError ]
```
