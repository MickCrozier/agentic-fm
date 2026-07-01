# BE Plugin — HTTP and Network

HTTP/HTTPS/FTP/SFTP requests via libcurl. Same underlying library as FileMaker's `Insert From URL`, but with full header control and additional methods.

**Platform:** All platforms.

---

## Setup functions (call before request)

### BE_CurlSetOption ( { option ; value } )
- **Returns:** 0 on success
- **Params:** `option` (text, optional) — libcurl option name | `value` (various, optional) — option value
- **Notes:** No params = reset **all** options to defaults. Option only (no value) = clear that specific option. Full option list: http://curl.haxx.se/libcurl/c/curl_easy_setopt.html. Options persist across calls until cleared. Renamed from `BE_Curl_Set_Option` in v4.0.2.
- **Common options:**
  - `CURLOPT_HTTPAUTH` + auth constant (`CURLAUTH_BASIC`, `CURLAUTH_DIGEST`, `CURLAUTH_NTLM`, `CURLAUTH_ANY`)
  - `CURLOPT_SSLCERT` / `CURLOPT_SSLKEY` — client certificates
  - `CURLOPT_COOKIEFILE` + `CURLOPT_COOKIEJAR` — cookie persistence
  - `BE_CURLOPT_FORCE_STARTTLS` = `True` — force STARTTLS (fixes Exchange/O365 error 35)
  - `CURLOPT_VERBOSE` = `0` — disable curl trace logging
  - `CURLOPT_SSL_VERIFYPEER` = `0` — skip SSL cert verification (testing only)

### BE_HTTP_SetCustomHeader ( { header ; value } )
- **Returns:** 0 on success
- **Params:** `header` (text, optional) — header name | `value` (text, optional) — header value
- **Notes:** Call multiple times to accumulate headers. No params = clear all headers. Header with no value = remove that header (v4.1.3+). Header with empty string value = set to empty string. Headers persist across requests until cleared. Renamed from `BE_HTTP_Set_Custom_Header` in v4.0.2.

### BE_HTTP_Set_Proxy ( proxy ; { port ; userName ; password } )
- **Returns:** 0 on success
- **Params:** `proxy` (text) — proxy hostname or URL | `port` (integer, optional, default: 80) | `userName` (text, optional) | `password` (text, optional)
- **Notes:** No auto-detection of OS proxy settings. Applies to HTTP, FTP, and SMTP.

---

## Request functions

### BE_HTTP_GET ( url ; { username ; password } )
- **Returns:** Response body as text
- **Params:** `url` (text) — HTTP/HTTPS/FTP/FTPS/SFTP URL | `username` (text, optional) | `password` (text, optional)
- **Notes:** For saving to disk use `BE_HTTP_GET_File`. Renamed from `BE_GetURL` in v3.3.0.

### BE_HTTP_GET_File ( url ; { path ; username ; password } )
- **Returns:** 0 on success; file written to `path`
- **Params:** `url` (text) | `path` (text, optional) — OS path to save file | `username` (text, optional) | `password` (text, optional)
- **Notes:** Saves response body to disk. Renamed from `BE_SaveURLToFile` in v3.3.0.

### BE_HTTP_POST ( url ; parameters ; { username ; password ; fileName } )
- **Returns:** Response body as text
- **Params:** `url` (text) | `parameters` (text) — POST body or url-encoded params | `username` (text, optional) | `password` (text, optional) | `fileName` (text, optional) — filename for binary data
- **Notes:** Set `Content-Type` via `BE_HTTP_SetCustomHeader` before calling. For file uploads, include `file=@/path/to/file` in params (OS path). For `multipart/form-data`, set Content-Type header to `multipart/mixed`.

### BE_HTTP_PATCH ( url ; parameters ; { username ; password } )
- **Returns:** Response body as text
- **Params:** `url` (text) | `parameters` (text) — PATCH body | `username` (text, optional) | `password` (text, optional)

### BE_HTTP_PUTData ( url ; data ; { username ; password } )
- **Returns:** Response body as text
- **Params:** `url` (text) | `data` (text) — PUT body | `username` (text, optional) | `password` (text, optional)
- **Notes:** Renamed from `BE_HTTP_PUT_DATA` in v4.0.2.

### BE_HTTP_PUTFile ( url ; path ; { username ; password } )
- **Returns:** Response body as text
- **Params:** `url` (text) | `path` (text) — OS path to file to upload | `username` (text, optional) | `password` (text, optional)
- **Notes:** Reads from disk and PUTs the file content. Set `Content-Type` header as required by the server.

### BE_HTTP_DELETE ( url ; { username ; password } )
- **Returns:** Response body as text (many DELETE endpoints return no body)
- **Params:** `url` (text) | `username` (text, optional) | `password` (text, optional)
- **Notes:** Check `BE_GetLastError` and `BE_HTTP_ResponseCode` since many DELETE endpoints return no body.

### BE_OpenURL ( url )
- **Returns:** 0 on success
- **Params:** `url` (text) — URL to open in default browser
- **Platform:** Mac ✓ / Win ✓ / FMS ✗ / iOS ✓ / Linux ✗

---

## Response inspection functions

### BE_HTTP_ResponseCode
- **Returns:** HTTP response code integer (e.g. 200, 401, 404)
- **Notes:** Call immediately after the HTTP request.

### BE_HTTP_ResponseHeaders ( { header } )
- **Returns:** All response headers as text, or a single named header's value
- **Params:** `header` (text, optional) — specific header name to retrieve
- **Notes:** Single-header lookup added in v3.3.2.

---

## Common patterns

### REST API call with JSON

```
Let ( [
	~ignore1 = BE_HTTP_SetCustomHeader ( "Content-Type" ; "application/json" ) ;
	~ignore2 = BE_HTTP_SetCustomHeader ( "Authorization" ; "Bearer " & $token ) ;
	~response = BE_HTTP_POST ( $url ; $jsonBody ) ;
	~code = BE_HTTP_ResponseCode ;
	~error = BE_GetLastError
] ;
	Case (
		~error ≠ 0 ; "cURL error: " & ~error ;
		~code ≥ 400 ; "HTTP " & ~code & ": " & ~response ;
		~response
	)
)
```

### Clear headers between calls

```
Set Variable [ $~ ; Value: BE_HTTP_SetCustomHeader ]  // clear all
```

### Basic authentication

```
Set Variable [ $~ ; Value: BE_CurlSetOption ( "CURLOPT_HTTPAUTH" ; "CURLAUTH_BASIC" ) ]
Set Variable [ $result ; Value: BE_HTTP_GET ( $url ; $username ; $password ) ]
```

### Skip SSL verification (testing only — never production)

```
Set Variable [ $~ ; Value: BE_CurlSetOption ( "CURLOPT_SSL_VERIFYPEER" ; 0 ) ]
```
