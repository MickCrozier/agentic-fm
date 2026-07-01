# BE Plugin — SMTP Email

Send email from FileMaker via SMTP/SMTPS. Works on FileMaker Server.

**Platform:** All platforms.

---

### BE_SMTPServer ( server ; { port ; username ; password ; keepOpen } )
- **Returns:** 0 on success (stores settings only — does not connect yet)
- **Params:** `server` (text) — hostname or IP | `port` (integer, optional) — empty uses server default; use 465 or 587 for SSL/TLS | `username` (text, optional) | `password` (text, optional) | `keepOpen` (boolean, optional, default: False) — keep connection open across multiple sends (Pro only)
- **Notes:** Subsequent calls overwrite previous settings. For Exchange/O365 SSL issues (error 35), also call `BE_CurlSetOption ( "BE_CURLOPT_FORCE_STARTTLS" ; True )`.

### BE_SMTPSend ( from ; to ; subject ; text ; { cc ; bcc ; replyTo ; html ; attachments } )
- **Returns:** 0 on success
- **Params:** `from` (text) | `to` (text or ¶-separated list) | `subject` (text) | `text` (text) — plain text body | `cc` (text or list, optional) | `bcc` (text or list, optional) | `replyTo` (text, optional) | `html` (text, optional) — HTML body | `attachments` (text or list, optional) — ¶-separated OS file paths
- **Notes:** Call `BE_SMTPServer` first. Some servers strip FM line endings — replace `Char(13)` with `Char(10)` in body text. BE SMTP does **not** save to sent folder by design. For container-field attachments use `BE_SMTPAddAttachment` instead of the `attachments` param. Check `BE_GetLastError` and `BE_CurlTrace` on failure.

### BE_SMTPAddAttachment ( { attachment ; contentType } )
- **Returns:** 0 on success
- **Params:** `attachment` (container) — container field with file | `contentType` (text) — MIME type (e.g. `"application/pdf"`, `"image/jpeg"`)
- **Notes:** Call multiple times before `BE_SMTPSend` to attach multiple container files. Files are temporarily written to OS temp folder during send. Attachment list is automatically cleared after each `BE_SMTPSend` call (success or failure). No params clears all pending attachments.

### BE_SMTPSetHeader ( { header ; value } )
- **Returns:** 0 on success
- **Params:** `header` (text, optional) — header name | `value` (text, optional) — header value
- **Notes:** Sets custom email headers (e.g. `X-Priority`, `Importance`, `X-Custom`). No params clears all custom headers. Actual effect depends on mail server and client. Renamed from `BE_SMTP_Set_Header` in v4.0.2.

---

## Common pattern: send email with attachment

```
Set Variable [ $~ ; Value: BE_SMTPServer ( "smtp.example.com" ; 587 ; $user ; $pass ) ]
Set Variable [ $~ ; Value: BE_CurlSetOption ( "CURLOPT_USE_SSL" ; 2 ) ]
Set Variable [ $~ ; Value: BE_SMTPAddAttachment ( MyTable::AttachmentField ; "application/pdf" ) ]
Set Variable [ $result ; Value: BE_SMTPSend (
	"from@example.com" ;
	"to@example.com" ;
	"Subject line" ;
	$plainTextBody ;
	"" ;           // cc
	"" ;           // bcc
	"" ;           // replyTo
	$htmlBody
) ]
Set Variable [ $err ; Value: BE_GetLastError ]
```

## SSL options for `BE_CurlSetOption`

| Scenario | Option | Value |
|---|---|---|
| TLS/STARTTLS (port 587) | `CURLOPT_USE_SSL` | `2` |
| SSL (port 465) | `CURLOPT_USE_SSL` | `3` |
| Exchange/O365 fix | `BE_CURLOPT_FORCE_STARTTLS` | `True` |
| Skip cert check (test) | `CURLOPT_SSL_VERIFYPEER` | `0` |
