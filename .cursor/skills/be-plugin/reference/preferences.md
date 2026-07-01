# BE Plugin — Preferences

OS-native key-value persistent storage using macOS plist (Mac/iOS) and Windows Registry (Windows).

**Platform:** Mac ✓ / Win ✓ / FMS ✓ / iOS ✓ / Linux ✗

---

### BE_SetPreference ( key ; value ; { domain } )
- **Returns:** 0 on success
- **Params:** `key` (text) | `value` (text) | `domain` (text, optional)
- **Notes:** Default domain on Mac/iOS: `au.com.goya.baseelements.plugin-user`. On Windows: `Software\\Goya\\BaseElements\\PluginUser` in `HKEY_CURRENT_USER`. Preferences are available across all open FileMaker files in the same FM process.

### BE_PreferenceGet ( key ; { domain } )
- **Returns:** Stored preference value, or empty if not set
- **Params:** `key` (text) | `domain` (text, optional)

### BE_PreferenceDelete ( key ; { domain } )
- **Returns:** 0 on success
- **Params:** `key` (text) | `domain` (text, optional)
- **Notes:** Required because on Mac, plist files are cached in memory and recreated on write — a standard file delete would be ineffective. This function properly removes the preference entry from the OS preference system.

---

## Custom domain

Use a custom domain to namespace your preferences and avoid collisions:

```
BE_SetPreference ( "lastSyncDate" ; Get(CurrentDate) ; "com.mycompany.mysolution" )
BE_PreferenceGet ( "lastSyncDate" ; "com.mycompany.mysolution" )
```
