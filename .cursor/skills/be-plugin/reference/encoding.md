# BE Plugin — Encoding and Encryption

Hashing, symmetric encryption, and digital signatures via OpenSSL.

**Platform:** All platforms.

> **Native FM alternatives (FM 16+):** Use native `Base64Encode`, `Base64Decode`, `Base64EncodeRFC`, `CryptDigest`, `CryptAuthCode` where available — the BE equivalents were removed in v4.2.0. Only use BE functions here for operations not covered by native FM.

---

### BE_MessageDigest ( text ; { algorithm ; encoding } )
- **Returns:** Hash value as binary, hex, or Base64 depending on `encoding`
- **Params:** `text` (text) — data to hash | `algorithm` (constant, optional, default: `BE_MessageDigestAlgorithmSHA256`) | `encoding` (constant, optional) — `BE_EncodingHex` (=1) or `BE_EncodingBase64`
- **Notes:** Algorithm constants include `BE_MessageDigestAlgorithmSHA256`, `BE_MessageDigestTypeMD5`. Prefer native `CryptDigest` for new FM 16+ solutions.

### BE_CipherEncrypt ( cipher ; data ; key ; iv ; { paddingBoolean ; fileNameWithExtension } )
- **Returns:** Encrypted data (hex text or container)
- **Params:** `cipher` (text, default: `"AES-256-CBC"`) — OpenSSL cipher name | `data` (text or container) | `key` (text or container) — hex-encoded | `iv` (text or container) — initialization vector | `paddingBoolean` (boolean, optional, default: True) | `fileNameWithExtension` (text, optional) — filename for container output
- **Notes:** Uses OpenSSL. **GCM and other authenticated modes are NOT supported.** Max 2 GB. Not all OpenSSL ciphers are guaranteed to work — test thoroughly.

### BE_CipherDecrypt ( cipher ; encryptedData ; key ; iv ; { paddingBoolean ; fileNameWithExtension } )
- **Returns:** Decrypted data (text or container)
- **Params:** Same structure as `BE_CipherEncrypt`; `encryptedData` must be hex-encoded.
- **Notes:** Mirrors `BE_CipherEncrypt`. GCM/authenticated modes not supported. Max 2 GB.

### BE_Encrypt_AES ( key ; text )
- **Returns:** Encrypted text, or `?` on error (check `BE_GetLastError`)
- **Params:** `key` (text) | `text` (text) — text to encrypt
- **Notes:** Simpler than `BE_CipherEncrypt`. Plugin-specific implementation — not interoperable with standard AES libraries. Use only for FM-to-FM encryption where both sides use this plugin.

### BE_Decrypt_AES ( key ; text )
- **Returns:** Decrypted text, or `?` on error
- **Params:** `key` (text) | `text` (text) — previously encrypted by `BE_Encrypt_AES`
- **Notes:** Only decrypts data produced by `BE_Encrypt_AES`.

### BE_SignatureGenerateRSA ( data ; privateKey ; { privateKeyPassword ; algorithm ; fileNameWithExtension } )
- **Returns:** Digital signature (container or text)
- **Params:** `data` (text or container) | `privateKey` (text) — PEM private key (PKCS#1 or PKCS#8) | `privateKeyPassword` (text, optional) | `algorithm` (text, optional, default: `"SHA256"`) | `fileNameWithExtension` (text, optional)
- **Notes:** Uses OpenSSL. Renamed from `BE_SignatureGenerate_RSA` in v4.0.2.

### BE_SignatureVerifyRSA ( data ; publicKey ; { signature ; algorithm } )
- **Returns:** True (1) if signature is valid, False (0) otherwise
- **Params:** `data` (text or container) | `publicKey` (text) — PEM public key | `signature` (container or Base64 text) | `algorithm` (text, optional, default: `"SHA256"`)
- **Notes:** Uses OpenSSL. Renamed from `BE_SignatureVerify_RSA` in v4.0.2.

---

## Constants

| Constant | Value | Used in |
|---|---|---|
| `BE_MessageDigestAlgorithmSHA256` | (internal) | `BE_MessageDigest` algorithm param |
| `BE_MessageDigestTypeMD5` | (internal) | `BE_MessageDigest` algorithm param |
| `BE_EncodingHex` | 1 | `BE_MessageDigest` encoding param |
| `BE_EncodingBase64` | (internal) | `BE_MessageDigest` encoding param |
