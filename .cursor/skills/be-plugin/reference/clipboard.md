# BE Plugin — Clipboard

Read and write the macOS/Windows system clipboard with type-specific binary access. Particularly useful for reading and writing FileMaker object XML (script steps, layout objects).

**Platform:** Mac FMP ✓ / Win FMP ✓ / FMS ✗ / iOS ✗ / Linux ✗

---

### BE_ClipboardFormats
- **Returns:** ¶-separated list of clipboard format type strings currently on the clipboard
- **Params:** None
- **Notes:** Formats are OS-level type codes. On Mac, copying FM script steps typically gives formats like `dyn.ah62d4rv4gk8zuxnxnq` and `CorePasteboardFlavorType 0x584D5353`. Call this first to discover what's on the clipboard before reading.

### BE_ClipboardGetText ( format )
- **Returns:** Text content of the clipboard in the specified format
- **Params:** `format` (text) — one of the values from `BE_ClipboardFormats`
- **Notes:** Text only — use `BE_ClipboardGetFile` for binary/container types. Encoding depends on BE_SetTextEncoding. Renamed from `BE_ClipboardText` in v4.0.2.

### BE_ClipboardGetFile ( format ; { fileName } )
- **Returns:** Container/binary data from the clipboard in the specified format
- **Params:** `format` (text) | `fileName` (text, optional) — filename for the result container
- **Notes:** Use in a `Set Field` step to store result in a container field. Providing `fileName` is recommended since not all clipboard types embed a filename.

### BE_ClipboardSetText ( text ; format )
- **Returns:** 0 on success
- **Params:** `text` (text) — content to place on clipboard | `format` (text) — clipboard type code
- **Notes:** Text only. On Windows, many text formats expect null-terminated strings — append `Char(0)` if the last character is being lost. Can only set a single format per call. Renamed from `BE_SetClipboardText` in v4.0.2.

### BE_ClipboardSetFile ( fileData ; format )
- **Returns:** 0 on success
- **Params:** `fileData` (container) — binary data to place on clipboard | `format` (text) — clipboard type code
- **Notes:** Binary only — use `BE_ClipboardSetText` for text. Can only set a single format. Copy a sample from the target app first, then use `BE_ClipboardFormats` to discover the correct type code.

---

## Common pattern: paste FileMaker script steps

```
// Write FM script step XML to clipboard on Mac
Set Variable [ $~ ; Value: BE_ClipboardSetText ( $scriptXML ; "dyn.ah62d4rv4gk8zuxnxnq" ) ]
// User then does ⌘V in Script Workspace
```

## Common pattern: read what's on the clipboard

```
Set Variable [ $formats ; Value: BE_ClipboardFormats ]
// Inspect $formats in Data Viewer, then:
Set Variable [ $content ; Value: BE_ClipboardGetText ( GetValue ( $formats ; 1 ) ) ]
```
