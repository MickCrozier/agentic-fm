# BE Plugin — FTP / SFTP / FTPS

Upload and delete files on FTP/SFTP/FTPS servers via libcurl.

**Platform:** All platforms.

> **Path note:** BE_FTP_Upload and BE_FTP_UploadFile use **absolute** URL paths; BE_FTP_Delete uses **relative** paths. This inconsistency is by design.

---

### BE_FTP_Upload ( url ; data ; { username ; password } )
- **Returns:** Response text (servers may not respond — check `BE_GetLastError`)
- **Params:** `url` (text) — ftp/sftp/ftps URL including **absolute** path and filename (e.g. `sftp://server/home/nick/folder/file.txt`) | `data` (container) — file to upload | `username` (text, optional) | `password` (text, optional)
- **Notes:** URL path is **absolute** from root. May be deprecated in a future version in favour of `Insert From URL`.

### BE_FTP_UploadFile ( url ; pathToFile ; { username ; password } )
- **Returns:** Response text (servers may not respond)
- **Params:** `url` (text) — absolute URL path | `pathToFile` (text) — OS path to local file | `username` (text, optional) | `password` (text, optional)
- **Notes:** Reads from a disk path rather than a container. URL path is **absolute**.

### BE_FTP_Delete ( url ; { username ; password } )
- **Returns:** Response text (servers may not respond — check `BE_GetLastError`)
- **Params:** `url` (text) — ftp/sftp/ftps URL using **relative** path from home folder (e.g. `sftp://server/folder/file.txt`) | `username` (text, optional) | `password` (text, optional)
- **Notes:** URL path is **relative** to the user's home folder — opposite of `BE_FTP_Upload`. May be deprecated in a future version.

---

## SSL / Authentication options

Use `BE_CurlSetOption` for SFTP key-based auth and SSL settings (see `http.md`):

```
// SFTP with private key
BE_CurlSetOption ( "CURLOPT_SSH_PRIVATE_KEYFILE" ; $keyPath )
BE_CurlSetOption ( "CURLOPT_SSH_PUBLIC_KEYFILE" ; $pubKeyPath )
BE_CurlSetOption ( "CURLOPT_SSH_AUTH_TYPES" ; "CURLSSH_AUTH_PUBLICKEY" )
```
