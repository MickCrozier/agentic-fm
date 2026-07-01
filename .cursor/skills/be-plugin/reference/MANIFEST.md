# Base Elements Plugin — Function Manifest

Scan this file first. Grep by function name or keyword, then read the matching category file for full parameter details.

**Path:** `agent/docs/reference/be-plugin/<category>.md`

> All paths passed to plugin functions are OS-native paths — NOT FileMaker paths.
> Always call `BE_GetLastError` after operations that can fail.
> `BE_*` function calls will produce FMLint C003 warnings — this is expected and safe to ignore.

---

## Arrays — `arrays.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_ArraySetFromValueList` | `BE_ArraySetFromValueList ( valueList ; { retainEmptyValues } )` | array, set, store, value list, memory |
| `BE_ArrayGetValue` | `BE_ArrayGetValue ( array ; valueNumber )` | array, get, retrieve, index, value |
| `BE_ArrayGetSize` | `BE_ArrayGetSize ( array )` | array, size, count, length |
| `BE_ArrayFind` | `BE_ArrayFind ( array ; value )` | array, find, search, position |
| `BE_ArrayChangeValue` | `BE_ArrayChangeValue ( array ; valueNumber ; newValue )` | array, change, update, modify |
| `BE_ArrayDelete` | `BE_ArrayDelete ( array )` | array, delete, remove, memory |

## Clipboard — `clipboard.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_ClipboardFormats` | `BE_ClipboardFormats` | clipboard, formats, types, list |
| `BE_ClipboardGetText` | `BE_ClipboardGetText ( format )` | clipboard, get, read, text, paste |
| `BE_ClipboardGetFile` | `BE_ClipboardGetFile ( format ; { fileName } )` | clipboard, get, binary, container, data |
| `BE_ClipboardSetText` | `BE_ClipboardSetText ( text ; format )` | clipboard, set, write, text, copy |
| `BE_ClipboardSetFile` | `BE_ClipboardSetFile ( fileData ; format )` | clipboard, set, binary, container, copy |

## Containers — `containers.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_ContainerCompress` | `BE_ContainerCompress ( data ; { filename } )` | container, compress, gzip, storage |
| `BE_ContainerUncompress` | `BE_ContainerUncompress ( gzip_data ; { filename } )` | container, uncompress, decompress, gzip |
| `BE_ContainerIsCompressed` | `BE_ContainerIsCompressed ( containerField )` | container, compressed, check, test |
| `BE_ContainerListTypes` | `BE_ContainerListTypes ( container )` | container, list, types, formats |
| `BE_ContainerGetType` | `BE_ContainerGetType ( container ; type )` | container, get, type, format, extract |
| `BE_ConvertContainer` | `BE_ConvertContainer ( field ; { type } )` | container, convert, image, file, type |
| `BE_ExportFieldContents` | `BE_ExportFieldContents ( field ; { outputPath } )` | container, export, field, contents, write, file |
| `BE_FileImport` | `BE_FileImport ( filePath ; { compressBoolean } )` | container, import, insert, file, load |
| `BE_JPEGRecompress` | `BE_JPEGRecompress ( jpeg ; { compressionLevel ; scale } )` | jpeg, compress, recompress, resize, image |

## Dialogs — `dialogs.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_DialogDisplay` | `BE_DialogDisplay ( title ; message ; defaultButton ; { cancelButton ; alternateButton } )` | dialog, display, alert, button, show |
| `BE_DialogProgress` | `BE_DialogProgress ( title ; description ; { maximum } )` | dialog, progress, loading, barber |
| `BE_DialogProgressUpdate` | `BE_DialogProgressUpdate ( number ; { description } )` | dialog, progress, update, advance, close |
| `BE_FileSaveDialog` | `BE_FileSaveDialog ( prompt ; { fileName ; inFolder } )` | dialog, file, save, path, select |
| `BE_FileSelectDialog` | `BE_FileSelectDialog ( prompt ; { inFolderPath } )` | dialog, file, select, open, path |
| `BE_FolderSelectDialog` | `BE_FolderSelectDialog ( prompt ; { inFolderPath } )` | dialog, folder, select, path, directory |

## Encoding and Encryption — `encoding.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_MessageDigest` | `BE_MessageDigest ( text ; { algorithm ; encoding } )` | hash, md5, sha, sha256, digest, checksum |
| `BE_CipherEncrypt` | `BE_CipherEncrypt ( cipher ; data ; key ; iv ; { padding ; filename } )` | encrypt, aes, cipher, openssl, cbc |
| `BE_CipherDecrypt` | `BE_CipherDecrypt ( cipher ; data ; key ; iv ; { padding ; filename } )` | decrypt, aes, cipher, openssl, cbc |
| `BE_Encrypt_AES` | `BE_Encrypt_AES ( key ; text )` | encrypt, aes, simple |
| `BE_Decrypt_AES` | `BE_Decrypt_AES ( key ; text )` | decrypt, aes, simple |
| `BE_SignatureGenerateRSA` | `BE_SignatureGenerateRSA ( data ; privateKey ; { password ; algorithm ; filename } )` | signature, rsa, sign, private key, digital, pem |
| `BE_SignatureVerifyRSA` | `BE_SignatureVerifyRSA ( data ; publicKey ; { signature ; algorithm } )` | signature, rsa, verify, public key, digital, pem |

## Error Checking — `errors.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_GetLastError` | `BE_GetLastError` | error, last, get, check, result |
| `BE_GetLastDDLError` | `BE_GetLastDDLError` | error, ddl, sql |
| `BE_CurlTrace` | `BE_CurlTrace` | curl, trace, debug, http, ftp, smtp, ssl |
| `BE_DebugInformation` | `BE_DebugInformation` | debug, information, diagnostics, support |

## Files and Folders — `files.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_FileExists` | `BE_FileExists ( path )` | file, exists, check, test, path |
| `BE_FileReadText` | `BE_FileReadText ( pathOrContainer ; { start ; to ; eolChar } )` | file, read, text, path, content, lines |
| `BE_FileWriteText` | `BE_FileWriteText ( pathOrContainer ; text ; { appendBoolean } )` | file, write, text, path, create, append |
| `BE_FilePatternCount` | `BE_FilePatternCount ( path ; searchText )` | file, pattern, count, search, find |
| `BE_FileReplaceText` | `BE_FileReplaceText ( pathOrContainer ; expression ; replaceString ; { options } )` | file, replace, text, regex, substitute |
| `BE_FileCopy` | `BE_FileCopy ( fromPath ; toPath ; { replace } )` | file, copy, duplicate, path |
| `BE_FileMove` | `BE_FileMove ( fromPath ; toPath ; { replace } )` | file, move, rename, path |
| `BE_FileDelete` | `BE_FileDelete ( path )` | file, delete, remove, path |
| `BE_FileSize` | `BE_FileSize ( path )` | file, size, bytes, length |
| `BE_FileModificationTimestamp` | `BE_FileModificationTimestamp ( path )` | file, modification, timestamp, date, time |
| `BE_FileOpen` | `BE_FileOpen ( path )` | file, open, launch, application |
| `BE_FileListFolder` | `BE_FileListFolder ( path ; { type ; subdirs ; fullPath ; hidden } )` | file, list, folder, directory, contents |
| `BE_FolderCreate` | `BE_FolderCreate ( path )` | folder, create, directory, path, mkdir |

## FTP — `ftp.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_FTP_Upload` | `BE_FTP_Upload ( url ; data ; { username ; password } )` | ftp, sftp, ftps, upload, file, transfer |
| `BE_FTP_UploadFile` | `BE_FTP_UploadFile ( url ; pathToFile ; { username ; password } )` | ftp, sftp, upload, file, path, transfer |
| `BE_FTP_Delete` | `BE_FTP_Delete ( url ; { username ; password } )` | ftp, sftp, delete, remove, file |

## HTTP and Network — `http.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_CurlSetOption` | `BE_CurlSetOption ( { option ; value } )` | curl, option, set, http, ssl, auth, proxy, certificate, cookie |
| `BE_HTTP_SetCustomHeader` | `BE_HTTP_SetCustomHeader ( { header ; value } )` | http, header, set, custom, content-type, authorization |
| `BE_HTTP_GET` | `BE_HTTP_GET ( url ; { username ; password } )` | http, get, request, url, download, rest, api |
| `BE_HTTP_GET_File` | `BE_HTTP_GET_File ( url ; { path ; username ; password } )` | http, get, download, file, save, path |
| `BE_HTTP_POST` | `BE_HTTP_POST ( url ; parameters ; { username ; password ; fileName } )` | http, post, request, rest, api, upload, send |
| `BE_HTTP_PATCH` | `BE_HTTP_PATCH ( url ; parameters ; { username ; password } )` | http, patch, rest, api, update |
| `BE_HTTP_PUTData` | `BE_HTTP_PUTData ( url ; data ; { username ; password } )` | http, put, rest, api, update, data |
| `BE_HTTP_PUTFile` | `BE_HTTP_PUTFile ( url ; path ; { username ; password } )` | http, put, file, upload, rest, path |
| `BE_HTTP_DELETE` | `BE_HTTP_DELETE ( url ; { username ; password } )` | http, delete, rest, api |
| `BE_HTTP_ResponseCode` | `BE_HTTP_ResponseCode` | http, response, code, status |
| `BE_HTTP_ResponseHeaders` | `BE_HTTP_ResponseHeaders ( { header } )` | http, response, headers, server |
| `BE_HTTP_Set_Proxy` | `BE_HTTP_Set_Proxy ( proxy ; { port ; userName ; password } )` | http, proxy, set, network |
| `BE_OpenURL` | `BE_OpenURL ( url )` | url, open, browser, launch |

## Miscellaneous — `misc.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_ExecuteSystemCommand` | `BE_ExecuteSystemCommand ( command ; { timeout ; useShell } )` | shell, execute, command, system, terminal, cmd, applescript |
| `BE_EvaluateJavaScript` | `BE_EvaluateJavaScript ( javaScript )` | javascript, evaluate, script, js |
| `BE_FileMakerSQL` | `BE_FileMakerSQL ( sql ; { colSep ; rowSep ; database ; asText ; outputPath } )` | sql, filemaker, executesql, query, database |
| `BE_RegularExpression` | `BE_RegularExpression ( text ; expression ; { options ; replaceString } )` | regex, regular expression, pattern, match, replace, pcre |
| `BE_ScriptExecute` | `BE_ScriptExecute ( scriptName ; { fileName ; parameter ; control } )` | script, execute, perform, run |
| `BE_ScriptStepInstall` | `BE_ScriptStepInstall ( name ; xml ; id ; description ; calculation )` | script, step, install, custom, register |
| `BE_ScriptStepPerform` | `BE_ScriptStepPerform ( scriptStepId )` | script, step, perform, execute |
| `BE_ScriptStepRemove` | `BE_ScriptStepRemove ( scriptStepId )` | script, step, remove, uninstall |
| `BE_SetTextEncoding` | `BE_SetTextEncoding ( { encoding } )` | encoding, text, utf8, utf16, charset |
| `BE_GetMachineName` | `BE_GetMachineName` | machine, name, computer, hostname |
| `BE_GetSystemDrive` | `BE_GetSystemDrive` | system, drive, path |
| `BE_Pause` | `BE_Pause ( milliseconds )` | pause, wait, delay, sleep, milliseconds |
| `BE_Version` | `BE_Version` | version, plugin, number |
| `BE_VersionAutoUpdate` | `BE_VersionAutoUpdate` | version, autoupdate, numeric, compare |

## PDF — `pdf.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_PDFPageCount` | `BE_PDFPageCount ( pdfPathOrContainer )` | pdf, page, count |
| `BE_PDFAppend` | `BE_PDFAppend ( pdf ; appendPdf ; { destinationPath } )` | pdf, append, merge, combine, join |
| `BE_PDFGetPages` | `BE_PDFGetPages ( pdf ; newPath ; fromPage ; { toPage } )` | pdf, pages, extract, split, get |

## Plugin Memory: Stack and Variables — `data.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_StackPush` | `BE_StackPush ( name ; value )` | stack, push, lifo, store, memory |
| `BE_StackPop` | `BE_StackPop ( name )` | stack, pop, lifo, retrieve, remove |
| `BE_StackCount` | `BE_StackCount ( name )` | stack, count, size, length |
| `BE_StackDelete` | `BE_StackDelete ( name )` | stack, delete, remove, clear |
| `BE_VariableSet` | `BE_VariableSet ( name ; { value } )` | variable, set, store, plugin, persistent |
| `BE_VariableGet` | `BE_VariableGet ( name )` | variable, get, retrieve, plugin, persistent |

## Preferences — `preferences.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_SetPreference` | `BE_SetPreference ( key ; value ; { domain } )` | preference, set, store, persist, key, value |
| `BE_PreferenceGet` | `BE_PreferenceGet ( key ; { domain } )` | preference, get, retrieve, key, value |
| `BE_PreferenceDelete` | `BE_PreferenceDelete ( key ; { domain } )` | preference, delete, remove, key |

## SMTP Email — `smtp.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_SMTPServer` | `BE_SMTPServer ( server ; { port ; username ; password ; keepOpen } )` | smtp, email, server, configure, connection |
| `BE_SMTPSend` | `BE_SMTPSend ( from ; to ; subject ; text ; { cc ; bcc ; replyTo ; html ; attachments } )` | smtp, email, send, attachment, html, cc, bcc |
| `BE_SMTPAddAttachment` | `BE_SMTPAddAttachment ( { attachment ; contentType } )` | smtp, email, attachment, container, mime |
| `BE_SMTPSetHeader` | `BE_SMTPSetHeader ( { header ; value } )` | smtp, email, header, custom, priority |

## Text — `text.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_TextExtractWords` | `BE_TextExtractWords ( text ; { wordPrefix } )` | text, extract, words, variables, prefix, parse |

## Time — `time.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_TimeCurrentMilliseconds` | `BE_TimeCurrentMilliseconds` | time, current, milliseconds, timestamp |
| `BE_TimeUTCMilliseconds` | `BE_TimeUTCMilliseconds` | time, utc, milliseconds, timestamp |
| `BE_TimeZoneOffset` | `BE_TimeZoneOffset` | time, utc, offset, timezone, zone |

## Value Lists — `values.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_ValuesUnique` | `BE_ValuesUnique ( listOfValues ; { caseSensitive } )` | values, unique, deduplicate, remove, duplicates, list |
| `BE_ValuesFilterOut` | `BE_ValuesFilterOut ( textToFilter ; filterValues ; { caseSensitive } )` | values, filter, remove, exclude, list |
| `BE_ValuesSort` | `BE_ValuesSort ( listOfValues ; { ascending ; type } )` | values, sort, order, list |
| `BE_ValuesContainsDuplicates` | `BE_ValuesContainsDuplicates ( listOfValues ; { caseSensitive } )` | values, duplicates, contains, check, test |
| `BE_ValuesTimesDuplicated` | `BE_ValuesTimesDuplicated ( listOfValues ; numberOfTimes )` | values, duplicates, count, times, frequency |
| `BE_ValuesTrim` | `BE_ValuesTrim ( listOfValues )` | values, trim, whitespace, clean, list |

## Vectors — `vectors.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_VectorDotProduct` | `BE_VectorDotProduct ( a ; b )` | vector, dot product, math, linear algebra |
| `BE_VectorEuclideanDistance` | `BE_VectorEuclideanDistance ( a ; b )` | vector, euclidean, distance, math, similarity, ai |

## XML, XSLT, and JSON — `xml.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_JSON_ArraySize` | `BE_JSON_ArraySize ( json ; { path } )` | json, array, size, count, length |
| `BE_XPath` | `BE_XPath ( xmlText ; xpathText ; { namespaceList ; asText } )` | xml, xpath, query, select, node |
| `BE_XPathAll` | `BE_XPathAll ( xmlText ; xpathText ; { namespaceList } )` | xml, xpath, all, query, multiple, nodes |
| `BE_XMLParse` | `BE_XMLParse ( pathOrXMLText )` | xml, parse, validate, well-formed, check |
| `BE_XMLValidate` | `BE_XMLValidate ( xmlText ; schemaText )` | xml, validate, schema, xsd |
| `BE_XML_Canonical` | `BE_XML_Canonical ( xml )` | xml, canonical, normalize, c14n, compare |
| `BE_XMLTidy` | `BE_XMLTidy ( xml )` | xml, tidy, format, pretty, indent |
| `BE_XMLStripNodes` | `BE_XMLStripNodes ( inputPath ; outputPath ; nodeNames )` | xml, strip, remove, nodes, filter, path |
| `BE_XMLStripInvalidCharacters` | `BE_XMLStripInvalidCharacters ( path ; { resultFilePath } )` | xml, strip, invalid, characters, clean |
| `BE_XSLTApply` | `BE_XSLTApply ( xmlFilePath ; xsltText ; outputFilePath ; { scriptName ; ... } )` | xml, xslt, transform, xsl, file, path |
| `BE_XSLT_ApplyInMemory` | `BE_XSLT_ApplyInMemory ( xmlText ; xsltText )` | xml, xslt, transform, xsl, memory |

## Zip and Gzip — `zip.md`
| Function | Signature | Keywords |
|---|---|---|
| `BE_Gzip` | `BE_Gzip ( data ; { filename } )` | gzip, compress, archive, container |
| `BE_UnGzip` | `BE_UnGzip ( gzip_data ; { filename } )` | gzip, decompress, uncompress, archive |
| `BE_Zip` | `BE_Zip ( filePathList ; { archiveFilePath } )` | zip, compress, archive, files, path |
| `BE_Unzip` | `BE_Unzip ( archiveFilePath ; { outputFolderPath } )` | unzip, decompress, extract, archive, path |

---

## Deprecated / Removed (do not use)

| Function | Removed | Replacement |
|---|---|---|
| `BE_Base64_Decode` | v4.2.0 | `Base64Decode` (native FM 16+) |
| `BE_Base64_Encode` | v4.2.0 | `Base64Encode` (native FM 16+) |
| `BE_Base64_URL_Encode` | v4.2.0 | `Base64EncodeRFC` (native FM 16+) |
| `BE_HMAC` | v4.2.0 | `CryptAuthCode` (native FM 16+) |
| `BE_JSON_Encode` | v4.2.0 | Native FM JSON functions (FM 16+) |
| `BE_JSONPath` | v5.0.0 | Native FM JSON functions (FM 16+) |
| `BE_JSON_Error_Description` | v5.0.0 | Native FM JSON functions (FM 16+) |
| `BE_ExecuteShellCommand` | v3.0.0 | `BE_ExecuteSystemCommand` |
| `BE_FileMaker_Fields` | v3.0.0 | `ExecuteSQL` (native) |
| `BE_FileMaker_Tables` | v3.0.0 | `ExecuteSQL` (native) |
