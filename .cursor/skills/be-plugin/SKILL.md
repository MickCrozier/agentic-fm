---
name: be-plugin
description: Reference for Base Elements Plugin (BE) calculation functions. Use when writing calculations or scripts that need plugin functions for file I/O, regex, cryptography, clipboard, AppleScript/shell execution, containers, PDF, SMTP, zip, or vectors. Triggers on "Base Elements", "BE_", specific function names, or capability requests like "regex in FileMaker", "read a file", "SHA hash", "run AppleScript from calculation". Do NOT trigger for HTTP/network requests, JSON, base64/encoding, or HMAC — these have native FM equivalents. Always check for a native FM function before recommending a BE function.
---

# Base Elements Plugin — Reference Skill

The Base Elements Plugin (BE) extends FileMaker with calculation functions for file I/O, networking, regex, crypto, clipboard, shell/AppleScript, and more. Functions are called like custom functions — `BE_FunctionName ( param1 ; param2 )`.

---

## Step 0 — Check availability and necessity FIRST

Before recommending or writing any BE function, work through this decision tree:

### 1. Does a native FM function cover this?

Check this table before reaching for BE. If a native equivalent exists, use it — no plugin dependency needed.

| Task | Native FM (FM 16+) | BE alternative (if no native) |
|---|---|---|
| Base64 encode | `Base64Encode ( data )` | ~~BE_Base64_Encode~~ (removed v4.2.0) |
| Base64 decode | `Base64Decode ( data ; filename )` | ~~BE_Base64_Decode~~ (removed v4.2.0) |
| Base64 URL-safe encode | `Base64EncodeRFC ( 4648 ; data )` | ~~BE_Base64_URL_Encode~~ (removed v4.2.0) |
| SHA / MD5 hash | `CryptDigest ( data ; algorithm )` | `BE_MessageDigest` (if older FM) |
| HMAC | `CryptAuthCode ( data ; algorithm ; key )` | ~~BE_HMAC~~ (removed v4.2.0) |
| JSON read/write | Native `JSONGetElement`, `JSONSetElement`, etc. | ~~BE_JSONPath~~ (removed v5.0.0) |
| JSON array size | Iterate with `ValueCount` / loop | `BE_JSON_ArraySize` (no native equivalent) |
| HTTP request | `Insert From URL` script step (native) | — use native |
| SQL query | `ExecuteSQL ( sql ; col ; row )` | `BE_FileMakerSQL` (cross-file, DDL, output to disk) |
| Send email | `Send Mail` script step | `BE_SMTPServer` + `BE_SMTPSend` (works on FMS, more control) |

### 2. Does the developer have the BE plugin?

**Ask before writing any BE code:**

> "This task would use the Base Elements Plugin. Do you have it installed in your FileMaker solution?"

If **yes** — proceed with the skill.

If **no** — direct them to download it:

> The Base Elements Plugin is free and open source. Download the latest release from:
> https://github.com/GoyaPtyLtd/BaseElements-Plugin/releases
>
> Install by placing the plugin file in your FileMaker Extensions folder:
> - **Mac:** `~/Library/Application Support/FileMaker/Extensions/`
> - **Windows:** `C:\Users\[user]\AppData\Local\FileMaker\Extensions\`
> - **FileMaker Server:** place in the server Extensions folder and restart FMS
>
> After installation, enable it in FileMaker under **Preferences → Plug-Ins**.

If the developer hasn't answered yet and the task clearly doesn't require BE (native FM can handle it), solve it without BE and note that the native approach was used.

### 3. Has the developer explicitly asked for BE?

If they've said "use Base Elements" or "use BE_" explicitly — proceed regardless of native alternatives. Respect the developer's tooling choice.

---

## Step 1 — Availability confirmed: check the catalog

The plugin must be installed and enabled in the target FileMaker solution. Functions return `"?"` when the plugin is not present. Check with:

```
BE_Version ( 1 )   // Returns version string if installed, "?" if not
```

The plugin must be present on every machine (server and client) that runs scripts containing BE calls.

The full function reference lives inside this skill folder:

```
.claude/skills/be-plugin/reference/MANIFEST.md       ← scan this first
.claude/skills/be-plugin/reference/<category>.md     ← read for full param details
```

---

## Step 2 — FMLint behavior

FMLint will raise **C003** (unknown custom function) for all `BE_*` calls. This is expected — the linter has no way to distinguish BE functions from missing custom functions. **Do not fix C003 warnings on BE_ functions.** Document this expectation in the script's `$README` disabled step if it will confuse future readers.

---

## Function catalog

The full function reference lives at:

```
agent/docs/reference/be-plugin/MANIFEST.md         ← scan this first
agent/docs/reference/be-plugin/<category>.md       ← read for full param details
```

**Lookup workflow:**

1. `grep -i "keyword" .claude/skills/be-plugin/reference/MANIFEST.md` to find the right function
2. Read the matching category file for full parameter details, return values, and gotchas
3. If the catalog doesn't cover the function, fall back to the GitHub docs: https://github.com/GoyaPtyLtd/BaseElements-Plugin/tree/main/docs

---

## Categories

| Category | File | Functions cover |
|---|---|---|
| Arrays | `arrays.md` | Plugin-memory arrays indexed from a value list |
| Clipboard | `clipboard.md` | Read/write macOS/Windows clipboard (text, binary, FM objects) |
| Containers | `containers.md` | Compress, convert, export, import, resize container content |
| Dialogs | `dialogs.md` | OS dialogs, progress bars, file/folder pickers |
| Encoding / Encryption | `encoding.md` | SHA/MD5 hashing, AES encrypt/decrypt, RSA signatures |
| Error Checking | `errors.md` | `BE_GetLastError`, curl trace, debug info |
| Files and Folders | `files.md` | Read, write, move, delete, list files on disk |
| FTP | `ftp.md` | FTP/SFTP/FTPS upload and delete |
| HTTP / Network | `http.md` | GET, POST, PUT, PATCH, DELETE, headers, curl options |
| Miscellaneous | `misc.md` | Shell/AppleScript, regex, FileMaker SQL, script execution, version |
| PDF | `pdf.md` | Page count, merge, extract pages |
| Plugin Memory | `data.md` | Named stacks (LIFO) and persistent plugin variables |
| Preferences | `preferences.md` | macOS plist / Windows Registry key-value storage |
| SMTP | `smtp.md` | Send email with attachments from FileMaker Server |
| Text | `text.md` | Extract words/variables from calculation text |
| Time | `time.md` | Millisecond-precision timestamps and UTC offset |
| Value Lists | `values.md` | Unique, filter-out, sort, deduplicate ¶-separated lists |
| Vectors | `vectors.md` | Dot product and Euclidean distance for AI embeddings |
| XML / XSLT / JSON | `xml.md` | XPath, XSD validation, XSLT transforms, JSON array size |
| Zip / Gzip | `zip.md` | Create and extract zip archives and gzip streams |

---

## General usage patterns

### Error handling

BE functions set a plugin error code retrievable with `BE_GetLastError`. Always check after operations that can fail (file not found, HTTP error, etc.):

```
Let ( [
	~result = BE_FileReadText ( $path ) ;
	~error  = BE_GetLastError
] ;
	If ( ~error = 0 ; ~result ; "Error: " & ~error )
)
```

### HTTP requests

```
// Simple GET
BE_HTTP_GET ( "https://api.example.com/data" )

// POST with JSON body and headers
Let ( [
	~ignore = BE_SetCustomHeader ( "Content-Type" ; "application/json" ) ;
	~ignore = BE_SetCustomHeader ( "Authorization" ; "Bearer " & $token )
] ;
	BE_HTTP_POST ( $url ; $jsonBody )
)
```

Reset headers between calls with `BE_CurlSetOption ( "CURLOPT_HTTPHEADER" ; "" )` or use `BE_HTTP_Set_Custom_Header` with empty value.

### Regex

```
// Find first match
BE_RegExFind ( $text ; "pattern" )

// Replace all matches
BE_RegExReplace ( $text ; "pattern" ; "replacement" )

// Find with capture groups — returns ¶-delimited list of groups
BE_RegExFindAll ( $text ; "(group1)(group2)" )
```

Uses PCRE (Perl-Compatible Regular Expressions). Backslashes in patterns must be escaped: `\\d` for digit.

### File paths

- Use POSIX paths on Mac: `/Users/name/Documents/file.txt`
- Use Windows paths on Windows: `C:\Users\name\Documents\file.txt`
- Use `BE_FileGetPosixPath ( container )` to get a usable path from a container field
- `BE_FolderCreate`, `BE_FileCopy`, `BE_FileDelete` for filesystem operations

### Encoding

```
BE_Base64_Encode ( $data )            // encode
BE_Base64_Decode ( $encoded ; "" )    // decode to text
BE_Base64_Decode_RFData ( $encoded )  // decode to container

BE_SHA256 ( $data )                   // hex SHA-256
BE_HMAC ( $data ; $key ; "SHA256" )  // HMAC-SHA256
```

---

## Platform differences

| Function area | Mac | Windows |
|---|---|---|
| AppleScript | Full support | Not available |
| Shell commands | `BE_ExecuteSystemCommand` runs zsh/bash | Runs cmd.exe |
| Clipboard | Full FM object support | Text and image only |
| File paths | POSIX (`/path/to/file`) | Windows (`C:\path\to\file`) |
| SMTP | Supported | Supported |

Always check the per-function platform notes in the catalog for specifics.

---

## Version checking

```
BE_Version ( 0 )   // Short version: "5.0.0"
BE_Version ( 1 )   // Long version with build info
```

Minimum recommended version: 4.0+ for full HTTP/JSON support; 5.0+ for JWT and modern crypto.

---

## Writing BE calls in scripts

BE functions appear in `Set Variable` steps or inline in calculations. No special script step is needed — treat them exactly like native FM functions or custom functions:

```
Set Variable [ $result ; BE_HTTP_GET ( $url ) ]
Set Variable [ $error  ; BE_GetLastError ]
If [ $error ≠ 0 ]
  # Handle error
End If
```

Long BE calls with many parameters should use `Let()` for readability per CODING_CONVENTIONS.md.
