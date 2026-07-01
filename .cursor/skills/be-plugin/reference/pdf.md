# BE Plugin — PDF

Count pages, merge, and extract pages from PDF files.

**Platform:** Mac ✓ / Win ✓ / FMS ✓ / iOS ✗ / Linux ✓

---

### BE_PDFPageCount ( pdfPathOrContainer )
- **Returns:** Number of pages, or 0 if the file cannot be parsed
- **Params:** `pdfPathOrContainer` (container or path text)
- **Notes:** Returns 0 for non-standard PDFs the plugin library cannot parse. Always check this before attempting `BE_PDFAppend` or `BE_PDFGetPages`. If it returns 0, consider using Ghostscript via `BE_ExecuteSystemCommand` or a PDF repair API.

### BE_PDFAppend ( pdfPathOrContainer ; appendPathOrContainer ; { destinationPath } )
- **Returns:** Container with merged PDF (when no `destinationPath`), or 0 on success writing to path
- **Params:** `pdfPathOrContainer` (container or path) — first PDF | `appendPathOrContainer` (container or path) — PDF to append | `destinationPath` (text, optional) — OS path for output file
- **Notes:** Will fail for non-standard PDFs (where `BE_PDFPageCount` returns 0).

### BE_PDFGetPages ( pdfPathOrContainer ; newPDFPath ; fromPageNum ; { toPageNum } )
- **Returns:** 0 on success; output written to `newPDFPath`
- **Params:** `pdfPathOrContainer` (container or path) | `newPDFPath` (text) — OS output path | `fromPageNum` (integer) | `toPageNum` (integer, optional, default: end of document)
- **Notes:** Output includes garbage collection to reduce file size (since v4.2.0).

---

## Example: merge two PDFs to disk

```
Set Variable [ $pageCount ; Value: BE_PDFPageCount ( $pdf1 ) ]
If [ $pageCount = 0 ]
  # Handle non-standard PDF
Else
  Set Variable [ $~ ; Value: BE_PDFAppend ( $pdf1 ; $pdf2 ; "/tmp/merged.pdf" ) ]
End If
```
