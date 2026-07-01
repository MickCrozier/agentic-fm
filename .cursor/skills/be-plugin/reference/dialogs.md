# BE Plugin — Dialogs

OS-native dialogs callable from calculations. Useful on FileMaker client when native script steps are not flexible enough.

**Platform:** Mac FMP ✓ / Win FMP ✓ / FMS ✗ / iOS ✗ / Linux ✗

---

### BE_DialogDisplay ( title ; message ; defaultButton ; { cancelButton ; alternateButton } )
- **Returns:** Integer — button clicked: 1=default (right), 2=cancel (left), 3=alternate (middle)
- **Params:** `title` (text) | `message` (text) | `defaultButton` (text) — right/primary button label | `cancelButton` (text, optional) — left button | `alternateButton` (text, optional) — middle button
- **Notes:** Callable from a calculation. Renamed from `BE_DisplayDialog` in v4.0.2.

### BE_DialogProgress ( title ; description ; { maximum } )
- **Returns:** 0 on success (stores settings — dialog appears immediately)
- **Params:** `title` (text) | `description` (text) | `maximum` (integer, optional) — omit for indeterminate (barber-pole); provide positive integer for determinate
- **Notes:** Disable Cancel with `Allow User Abort [Off]` before calling. Close the barber-pole by calling `BE_DialogProgressUpdate` with any positive integer. Close the determinate dialog by passing a value >= maximum. Renamed from `BE_ProgressDialog` in v4.0.2.

### BE_DialogProgressUpdate ( number ; { description } )
- **Returns:** 0 on success
- **Params:** `number` (integer) — new progress value | `description` (text, optional) — updated message text
- **Notes:** Advances or closes the progress dialog. Any value >= maximum closes a determinate dialog. Any positive integer closes a barber-pole dialog. Renamed from `BE_ProgressDialog_Update` in v4.0.2.

### BE_FileSaveDialog ( prompt ; { fileName ; inFolder } )
- **Returns:** OS path to file the user chose, or empty if cancelled
- **Params:** `prompt` (text) — dialog title | `fileName` (text, optional) — default filename | `inFolder` (text, optional) — starting folder path
- **Notes:** Returns an OS path, not a FileMaker path. Check `BE_GetLastError` for non-zero on error. Renamed from `BE_SaveFileDialog` in v4.0.2.

### BE_FileSelectDialog ( prompt ; { inFolderPath } )
- **Returns:** OS path to selected file, or empty if cancelled
- **Params:** `prompt` (text) | `inFolderPath` (text, optional)
- **Notes:** Supports multi-file selection (since v2.2.0). Returns OS path, not FileMaker path. Renamed from `BE_SelectFile` in v4.0.2.

### BE_FolderSelectDialog ( prompt ; { inFolderPath } )
- **Returns:** OS path to selected folder, or empty if cancelled
- **Params:** `prompt` (text) | `inFolderPath` (text, optional)
- **Notes:** Returns OS path, not FileMaker path. Renamed from `BE_SelectFolder` in v4.0.2.

---

## Example: progress dialog

```
// Start indeterminate
Set Variable [ $~ ; Value: BE_DialogProgress ( "Processing" ; "Please wait…" ) ]

// ... do work in a loop ...

// Update determinate (max 100)
Set Variable [ $~ ; Value: BE_DialogProgress ( "Processing" ; "Step 1 of 100" ; 100 ) ]
Set Variable [ $~ ; Value: BE_DialogProgressUpdate ( 50 ; "Step 50 of 100" ) ]
Set Variable [ $~ ; Value: BE_DialogProgressUpdate ( 100 ) ]  // closes dialog
```
