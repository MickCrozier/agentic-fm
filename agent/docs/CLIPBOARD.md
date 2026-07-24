# Clipboard Interaction

FileMaker does not use plain text for clipboard objects. When you copy scripts, steps, fields, custom functions, or other objects in FileMaker, they are placed on the macOS clipboard as proprietary binary descriptor classes — not as readable text.

**Use the plugin for all clipboard I/O.** `agfm_bridge.py clipboard-read` and `clipboard-write` handle the class detection and encoding for you, on the macOS host and inside a dev container alike:

```bash
python3 agent/scripts/agfm_bridge.py clipboard-read
python3 agent/scripts/agfm_bridge.py clipboard-write agent/sandbox/{Solution}/MyScript.xml
```

**Do not use `pbpaste` or `pbcopy` for FileMaker objects.** Both tools silently corrupt multi-byte UTF-8 characters (such as `≠`, `≤`, `≥`, `¶`) that are common in FileMaker calculations.

The rest of this document is background on the underlying format — useful when debugging a paste that FileMaker silently ignores.

---

## Clipboard class codes

Each FileMaker object type corresponds to a four-letter AppleScript class code:

| Code   | FileMaker object          | fmxmlsnippet element       |
|--------|---------------------------|----------------------------|
| `XMSS` | Script Steps              | `<Step>`                   |
| `XMSC` | Script                    | `<Script>`                 |
| `XML2` | Layout Objects            | `<Layout>` (v12+)          |
| `XMLO` | Layout Objects (legacy)   | `<Layout>`                 |
| `XMFD` | Field Definition          | `<Field>`                  |
| `XMFN` | Custom Function           | `<CustomFunction>`         |
| `XMTB` | Table                     | `<BaseTable>`              |
| `XMVL` | Value List                | `<ValueList>`              |
| `XMTH` | Theme                     | `<Theme>`                  |

This project primarily works with `XMSS` (the output format is steps-only inside `<fmxmlsnippet type="FMObjectList">`).

### CorePasteboardFlavorType values

When accessing the clipboard via the macOS Pasteboard API directly (e.g. via PyObjC's `NSPasteboard`), each class code maps to a `CorePasteboardFlavorType` string. The hex value is simply the four ASCII bytes of the class code interpreted as a big-endian 32-bit integer:

| Code   | Hex value    | Pasteboard type string                         |
|--------|--------------|------------------------------------------------|
| `XMSS` | `0x584D5353` | `CorePasteboardFlavorType 0x584D5353`          |
| `XMSC` | `0x584D5343` | `CorePasteboardFlavorType 0x584D5343`          |
| `XML2` | `0x584D4C32` | `CorePasteboardFlavorType 0x584D4C32`          |
| `XMLO` | `0x584D4C4F` | `CorePasteboardFlavorType 0x584D4C4F`          |
| `XMFD` | `0x584D4644` | `CorePasteboardFlavorType 0x584D4644`          |
| `XMFN` | `0x584D464E` | `CorePasteboardFlavorType 0x584D464E`          |
| `XMTB` | `0x584D5442` | `CorePasteboardFlavorType 0x584D5442`          |
| `XMVL` | `0x584D564C` | `CorePasteboardFlavorType 0x584D564C`          |
| `XMTH` | `0x584D5448` | `CorePasteboardFlavorType 0x584D5448`          |
| `ut16` | `0x75743136` | `CorePasteboardFlavorType 0x75743136`          |

---

## Using agfm_bridge.py

All clipboard I/O goes through the plugin. `agfm_bridge.py` handles both directions and the plugin auto-detects the correct class code from the XML content.

### Read: FM objects on clipboard → XML

After copying objects in FileMaker (`⌘C`), run:

```bash
# Print to stdout
python3 agent/scripts/agfm_bridge.py clipboard-read

# Save into the sandbox
python3 agent/scripts/agfm_bridge.py clipboard-read > agent/sandbox/{Solution}/myscript.xml
```

### Write: XML file → FM objects on clipboard

To place a snippet on the clipboard for a manual paste into FileMaker (`⌘V`):

```bash
python3 agent/scripts/agfm_bridge.py clipboard-write agent/sandbox/{Solution}/myscript.xml
```

Class detection reads the first XML element inside the fmxmlsnippet wrapper and maps it to the correct class (e.g. `<Step>` → `XMSS`, `<CustomFunction>` → `XMFN`).

For **scripts**, prefer `deploy` / `bundle` / `patch` over a clipboard write — they insert the steps directly and skip the manual paste entirely.

### Other clipboard endpoints

| Endpoint | Use |
|---|---|
| `POST /api/clipboard/digest` | Re-digest the current clipboard when a read decodes badly |
| `GET /api/clipboard/history` | List snapshot-store entries |
| `POST /api/clipboard/promote` | Promote a historical snapshot back to active |
| `POST /api/clipboard/inspect` | Read a sub-region of a large snapshot (e.g. layout XML) |

---

## How it works (low-level)

Background on the underlying encoding. The plugin does all of this for you — this section is here for diagnosing a paste that FileMaker silently ignores.

### Reading (FM → XML)

FileMaker stores clipboard data as a record keyed by the full AppleScript class notation: `{«class XMSS»: «data XMSS3C...»}`. The key point is that you must use `«class XMSS»` (not bare `XMSS`) as the property accessor — otherwise AppleScript cannot find the key in the record.

A reader must detect the class, then fetch the value as a coercion — e.g. `the clipboard as «class XMSS»`. The `as` coercion form is used rather than `«class XMSS» of (the clipboard)` — the `of` form treats the clipboard as a record and fails when the clipboard's primary type is plain text (which happens when a single text label is copied in Layout Mode). The `as` form locates the requested type regardless of what the primary type is. osascript prints the binary descriptor as:

```
«data XMSS3C666D786D6C736E69707065743C...»
```

The script then:
1. Extracts the hex portion with a regex
2. Converts hex → bytes with `bytes.fromhex()`
3. Decodes as UTF-8
4. Pretty-prints with `xmllint --format -` (included with macOS Xcode command line tools)

The equivalent AppleScript pipeline (as used by the [Typinator](https://www.ergonis.com/typinator) approach and [FmClipTools](https://github.com/DanShockley/FmClipTools)) is:

```applescript
try
    set allowed to {«class XMSS», «class XML2», «class XMLO», «class XMSC», «class XMFD», «class XMFN», «class XMTB», «class XMVL», «class XMTH»}
    set clipboardType to item 1 of item 1 of (clipboard info) as class
    if clipboardType is in allowed then
        -- classString will be e.g. "«class XMSS»" — must use this full form, not bare "XMSS"
        set classString to clipboardType as string
        return do shell script "osascript -e '" & classString & " of (the clipboard)' | sed 's/«data ....//; s/»//' | xxd -r -p | iconv -f UTF-8 -t UTF-8 | xmllint --format -"
    end if
on error errMsg
    return "ERROR: " & errMsg
end try
```

### Writing (XML → FM)

To place an fmxmlsnippet on the clipboard in the correct class for FileMaker to accept:

```applescript
-- Replace XMSS with the appropriate class code and hexdata with the hex-encoded XML
set the clipboard to «data XMSShexdata»
```

From the shell (replace `XMSS` and the file path as needed):

```bash
osascript -e "set the clipboard to «data XMSS$(xxd -p < agent/sandbox/myscript.xml | tr -d '\n')»"
```

`xxd -p` produces the raw hex encoding of the file bytes. The `tr -d '\n'` removes newlines so the hex is a single unbroken string.

---

## Detecting what is on the clipboard

To check whether the clipboard currently holds FileMaker objects (and which type):

```applescript
try
    set allowed to {«class XMSS», «class XML2», «class XMLO», «class XMSC», «class XMFD», «class XMFN», «class XMTB», «class XMVL», «class XMTH»}
    set clipboardType to item 1 of item 1 of (clipboard info) as class
    if clipboardType is in allowed then
        return clipboardType as string  -- returns e.g. "XMSS"
    else
        return "No FileMaker objects on clipboard"
    end if
on error
    return "Clipboard is empty or unreadable"
end try
```

---

## NSPasteboard

The plugin reads and writes the clipboard through `NSPasteboard` directly rather than shelling out. This avoids:
- Process launch overhead (significant for large snippets)
- The hex-encode/decode round-trip (`«data XMSS3C...»` → regex → `bytes.fromhex()`)
- Argument-length pressure from very large hex strings passed on a command line

### How NSPasteboard reads FM binary data

```python
pb = NSPasteboard.generalPasteboard()
pb_type = "CorePasteboardFlavorType 0x584D5353"   # XMSS
data = pb.dataForType_(pb_type)
xml = data.bytes().tobytes().decode('utf-8')
```

### How NSPasteboard reads ut16 menu data

```python
raw_bytes = pb.dataForType_("CorePasteboardFlavorType 0x75743136").bytes().tobytes()
xml = raw_bytes.decode('utf-16')   # BOM is present; Python handles it automatically
```

### How NSPasteboard writes FM data

```python
pb.clearContents()
ns_data = NSData.dataWithBytes_length_(xml_bytes, len(xml_bytes))
pb.setData_forType_(ns_data, "CorePasteboardFlavorType 0x584D5353")
```

Note that `pb.clearContents()` is required before writing — without it, stale data from a previous copy may persist alongside the new data.

---

## Reading layout objects

Layout XML is large and verbose (~1–2 MB for a complex layout). It contains all object definitions, button actions, styles, and conditional formatting.

### How to copy a layout

The agent cannot copy a layout autonomously — the user must do it in FileMaker:

1. Switch to **Layout Mode** on the target layout
2. **⌘A** — select all objects
3. **⌘C** — copy

This places the layout XML on the clipboard as class `XML2` (`LayoutObjectList`).

### Reading the clipboard

Read the clipboard through the plugin:

```bash
python3 agent/scripts/agfm_bridge.py clipboard-read
```

This works identically on the macOS host and inside a dev container — `agfm_bridge.py` resolves the plugin host for you. If the clipboard content does not decode cleanly, re-digest it with `POST /api/clipboard/digest` and read again.

### Extracting button script actions

Layout XML is too large to read in full. Grep or parse for `<Script>` elements and nearby `<Step name="Perform Script">` steps to extract button actions:

```python
import json, xml.etree.ElementTree as ET
d = json.load(open(...))
root = ET.fromstring(d['xml'])
for step in root.findall('.//Step[@name="Perform Script"]'):
    scr = step.find('Script')
    param = step.find('.//Calculation')
    print(scr.get('name'), param.text if param is not None else '')
```

---

## Reference

The approach above is derived from [FmClipTools](https://github.com/DanShockley/FmClipTools) by Daniel A. Shockley and Erik Shagdar, which provides a complete AppleScript library for FileMaker clipboard operations including batch conversion, prettifying, and class detection.
