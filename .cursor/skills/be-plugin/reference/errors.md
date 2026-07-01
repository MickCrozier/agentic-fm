# BE Plugin — Error Checking

Always check `BE_GetLastError` after any operation that can fail. These functions do not themselves reset the error state.

---

### BE_GetLastError
- **Returns:** Integer error code from the most recent plugin function call
- **Params:** None
- **Notes:** 0 = success. Plugin-defined codes: 1 = user cancelled, 3 = platform incompatible. Other codes come from cURL, OS, or file system libraries. cURL error codes: http://curl.haxx.se/libcurl/c/libcurl-errors.html. **Calling `BE_GetLastError` does NOT reset the error** — only the next actual plugin function call does.
- **Platform:** All platforms

### BE_GetLastDDLError
- **Returns:** DDL error text from the most recent `BE_FileMakerSQL` call
- **Params:** None
- **Platform:** All platforms

### BE_CurlTrace
- **Returns:** Full transcript of the most recent HTTP/FTP/SMTP connection
- **Params:** None
- **Notes:** Useful for diagnosing SSL/TLS handshake and authentication issues. Enabled by default; disable with `BE_CurlSetOption ( "CURLOPT_VERBOSE" ; 0 )`. Only stores the last call — call immediately after the HTTP function for accurate results.
- **Platform:** All platforms

### BE_DebugInformation
- **Returns:** Diagnostic text blob for filing bug reports
- **Params:** None
- **Notes:** May contain sensitive data (HTTP traces). Include when filing plugin support issues. Does not expose passwords.
- **Platform:** All platforms

---

## Standard error-check pattern

```
Let ( [
	~result = BE_SomFunction ( $params ) ;
	~error  = BE_GetLastError
] ;
	If ( ~error = 0 ;
		~result ;
		"Error " & ~error & ": " & BE_CurlTrace
	)
)
```

## Common error codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User cancelled dialog |
| 3 | Platform incompatible (function not available on this OS) |
| 7 | cURL: couldn't connect |
| 28 | cURL: operation timed out |
| 35 | cURL: SSL/TLS handshake failed (Exchange/O365 — try STARTTLS) |
| 60 | cURL: SSL certificate problem |
