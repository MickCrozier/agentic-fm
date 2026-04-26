---
name: print-layout
description: Generate FileMaker print/PDF layout objects as fmxmlsnippet XML2 clipboard content. Use when the developer asks to create a print layout, PDF layout, or printout for invoices, reports, letters, or similar documents. Produces a Python generator script that outputs the correct Object/FieldObj/TextObj XML format, then deploys to clipboard.
---

# Print Layout

Generate layout objects for a FileMaker print/PDF layout. Output is `fmxmlsnippet type="LayoutObjectList"` in the correct clipboard XML format, deployed via `clipboard.py write --class XML2`.

---

## Step 1: Gather context

Read `agent/CONTEXT.json`:
- `current_layout` — target layout name, ID, and base TO
- `tables` — fields with IDs available in this context
- Related TOs and their field IDs (from `agent/context/{solution}/*.index` if not in CONTEXT.json)

Read theme data:
```bash
cat agent/context/{solution}/theme-manifest.json   # theme UUID (internalName)
cat agent/context/{solution}/theme-classes.json     # named style classes
```

---

## Step 2: Resolve theme classes and CSS

### Label class
Look up `Label` in `theme-classes.json` (match by `displayName`). If found, use its UUID as the class name in the `LocalCSS` element of text objects. If not found, use the closest label/heading class available, or fall back to an empty LocalCSS.

### Field class
Use `Field Invisible` (or equivalent borderless field class) for all data fields on print layouts — print layouts must never show field borders.

### FullCSS
The `FullCSS` for each object must be the full computed CSS string for that object's style, HTML-entity-encoded (newlines → `&#10;`, tabs → `&#09;`). Obtain from a copied object in the same solution, or reconstruct from `theme.css` base styles + class overrides. The ThemeName comes from `theme-manifest.json` → `internalName`.

---

## Step 3: XML format

The correct clipboard format for layout objects is **not** the `<LayoutObject>` SaXML format. It uses:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<fmxmlsnippet type="LayoutObjectList">
<Layout enclosingRectTop="T" enclosingRectLeft="L" enclosingRectBottom="B" enclosingRectRight="R">
  <!-- objects here -->
</Layout>
</fmxmlsnippet>
```

The `enclosingRect` is the bounding box of all objects in the snippet. All coordinates are **absolute from the top of the layout** (not part-relative) and use 7 decimal places (e.g. `"240.0000000"`).

### Field object
```xml
<Object type="Field" key="N" LabelKey="0" flags="0" rotation="0">
  <Bounds top="T" left="L" bottom="B" right="R"/>
  <FieldObj numOfReps="1" flags="32" inputMode="0" keyboardType="1"
            displayType="0" quickFind="1" pictFormat="5">
    <Name>TABLE::FieldName</Name>
    <ExtendedAttributes fontHeight="18" graphicFormat="5">
      <NumFormat flags="2304" charStyle="0" negativeStyle="0" currencySymbol="$"
                 thousandsSep="44" decimalPoint="46" negativeColor="#DD000000"
                 decimalDigits="2" trueString="Yes" falseString="No"/>
      <DateFormat format="0" charStyle="0" monthStyle="0" dayStyle="0" separator="47">
        <DateElement>3</DateElement><DateElement>1</DateElement>
        <DateElement>6</DateElement><DateElement>8</DateElement>
        <DateElementSep index="0"></DateElementSep>
        <DateElementSep index="1">, </DateElementSep>
        <DateElementSep index="2"> </DateElementSep>
        <DateElementSep index="3"> </DateElementSep>
        <DateElementSep index="4"></DateElementSep>
      </DateFormat>
      <TimeFormat flags="143" charStyle="0" hourStyle="0" minsecStyle="1"
                  separator="58" amString=" am" pmString=" pm" ampmString=""/>
      <CharacterStyle mask="32695">
        <Font-family codeSet="Roman" fontId="7" postScript="ArialMT,sans-serif">arial,sans-serif</Font-family>
        <Font-size>16</Font-size><Face>0</Face><Color>#000000</Color>
      </CharacterStyle>
    </ExtendedAttributes>
    <Styles>
      <FullCSS>{HTML-encoded full CSS for this object's style}</FullCSS>
      <ThemeName>{theme internalName}</ThemeName>
    </Styles>
    <DDRInfo>
      <Field name="FieldName" id="N" repetition="1" maxRepetition="1" table="TABLE"/>
    </DDRInfo>
  </FieldObj>
</Object>
```

Key rules:
- `key` — unique sequential integer per object
- `LabelKey` — key of paired label text object; use `0` if no pairing needed
- `<Name>` — `TABLE::FieldName` (TO name, not base table name)
- `<DDRInfo>` — field name, ID (from CONTEXT.json or index), table name
- No `LocalCSS` on field objects — styling handled entirely by `FullCSS`

### Text object (label / heading)
```xml
<Object type="Text" key="N" LabelKey="0" flags="0" rotation="0">
  <Bounds top="T" left="L" bottom="B" right="R"/>
  <TextObj flags="0">
    <ExtendedAttributes fontHeight="18" graphicFormat="5">
      <!-- same NumFormat/DateFormat/TimeFormat/CharacterStyle as above -->
    </ExtendedAttributes>
    <Styles>
      <LocalCSS>{HTML-encoded override CSS, e.g. text-align: right;}</LocalCSS>
      <FullCSS>{HTML-encoded full CSS}</FullCSS>
      <ThemeName>{theme internalName}</ThemeName>
    </Styles>
    <CharacterStyleVector>
      <Style>
        <Data>{label text}</Data>
        <CharacterStyle mask="32695">
          <!-- same Font-family/size/face/color -->
        </CharacterStyle>
      </Style>
    </CharacterStyleVector>
    <ParagraphStyleVector>
      <Style>
        <Data>{label text}</Data>
        <ParagraphStyle mask="0"></ParagraphStyle>
      </Style>
    </ParagraphStyleVector>
  </TextObj>
</Object>
```

- Omit `<LocalCSS>` entirely if there are no overrides (left-aligned, no special style)
- `<CharacterStyleVector>` and `<ParagraphStyleVector>` must contain the label text verbatim in `<Data>`

---

## Step 4: Print layout standards

These standards apply to all print layouts in this solution:

### Labels
- **Class**: `Label` (look up UUID in `theme-classes.json`; fall back to `Primary Label Top` or nearest equivalent)
- **Height**: 15pt (bottom = top + 15)
- **Position**: immediately above the field they describe, with 2–3pt gap to the field

### Document header (Header part, y 0–80)
Standard header layout for all print documents:

| Region | Content |
|---|---|
| Top-left | `SYSTEM::Logo_g` container field — 80×60pt, at (10, 14) |
| Below logo | `SYSTEM::CompanyName_g` text field |
| Top-right | Document title text (e.g. "Tax Invoice") — large, bold |
| Below title | Document number field (e.g. invoice number, report ID) |

Suggested coordinates (layout width 595pt, header height 80pt):

```
Logo container:      top=10,  left=14,  bottom=70,  right=94
Company name field:  top=24,  left=104, bottom=46,  right=380
Document title text: top=10,  left=380, bottom=40,  right=581
Document number fld: top=43,  left=380, bottom=65,  right=581
```

### Document footer (Footer part)
- Height: 30pt
- Left: `SYSTEM::CompanyName_g` (small, muted)
- Right: "Page" text label — developer adds Page Number field in Layout Mode

### Fields
- All data fields: use `Field Invisible` class (no borders — essential for print)
- Number fields (currency): include `<NumFormat>` with `decimalDigits="2"`
- Date fields: include `<DateFormat>` with appropriate separator
- Container fields (logo): set `pictFormat="5"` (scale to fit)

### Layout dimensions
- **A4 portrait**: width 595pt
- **US Letter portrait**: width 612pt
- Default margin: 14pt left/right

---

## Step 5: Generate using Python

Always generate layout objects via a Python script in `agent/sandbox/` rather than writing XML by hand. This keeps CSS encoding correct and makes iterative changes easy.

### Generator script structure

```python
#!/usr/bin/env python3
"""Generate {LayoutName}-objects.xml."""

THEME = "{theme internalName}"
LABEL_CLASS = "{Label class UUID or name}"  # from theme-classes.json
FIELD_INVISIBLE_CLASS = "{Field Invisible UUID}"

FIELD_FULL_CSS = "..."   # full computed CSS for Field Invisible style
TEXT_FULL_CSS_LEFT = "..." # full computed CSS for text/label style (left-aligned)
TEXT_FULL_CSS_RIGHT = TEXT_FULL_CSS_LEFT.replace("text-align: left;", "text-align: right;")

def enc(css): return css.replace("\t", "&#09;").replace("\n", "&#10;")
def fmt(n):   return f"{float(n):.7f}"

key_counter = [0]
def next_key():
    key_counter[0] += 1
    return key_counter[0]

def field_obj(table, field_name, field_id, top, left, bottom, right,
              date_format=False, num_format=False, pic_format=5):
    """Emit an <Object type="Field"> block."""
    ...

def text_obj(text, top, left, bottom, right, align="left"):
    """Emit an <Object type="Text"> block. Labels are always bottom=top+15."""
    ...

def label(text, top, left, right, align="left"):
    """Convenience: text_obj with fixed 15pt height."""
    return text_obj(text, top, left, top + 15, right, align)

# --- build objects ---
objects = []

# Header
objects.append(field_obj("SYSTEM", "Logo_g", 6,      top=10, left=14,  bottom=70, right=94,  pic_format=5))
objects.append(field_obj("SYSTEM", "CompanyName_g", 9, top=24, left=104, bottom=46, right=380))
objects.append(text_obj("Tax Invoice",               top=10, left=380, bottom=40, right=581, align="right"))
objects.append(field_obj("TABLE",  "InvoiceNumber", N, top=43, left=380, bottom=65, right=581))

# Body — fields and labels
# ...

# Footer
objects.append(field_obj("SYSTEM", "CompanyName_g", 9, top=568, left=14,  bottom=582, right=300))
objects.append(text_obj("Page",                       top=568, left=450, bottom=582, right=581, align="right"))

# --- write output ---
enclosing = (0, 0, 590, 595)  # top, left, bottom, right
with open("agent/sandbox/{LayoutName}-objects.xml", "w") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    f.write('<fmxmlsnippet type="LayoutObjectList">\n')
    f.write(f'<Layout enclosingRectTop="{fmt(enclosing[0])}" enclosingRectLeft="{fmt(enclosing[1])}" '
            f'enclosingRectBottom="{fmt(enclosing[2])}" enclosingRectRight="{fmt(enclosing[3])}">\n')
    for obj in objects:
        f.write(obj + "\n")
    f.write('</Layout>\n</fmxmlsnippet>\n')
```

### Obtaining FullCSS values

The `FullCSS` string must match the solution's theme exactly. The most reliable way to get it:

1. In FileMaker Layout Mode, create a sample field with the target style applied
2. Copy it (⌘C)
3. Run: `python3 agent/scripts/clipboard.py read agent/sandbox/sample.xml`
4. Extract the `<FullCSS>` content from the output

Alternatively, derive it from `theme.css` base styles + class overrides from `theme-classes.json`.

---

## Step 6: Deploy

```bash
python3 agent/sandbox/{LayoutName}-gen.py
python3 agent/scripts/clipboard.py write --class XML2 agent/sandbox/{LayoutName}-objects.xml
```

Paste instructions:
> The layout objects are on your clipboard.
>
> 1. Open **{Layout Name}** in Layout Mode
> 2. Click in the **Body** part to make it active
> 3. **⌘V** — paste
>
> Objects will land in the correct parts based on their absolute y-coordinates.
> Add the **Page Number** field to the Footer manually (Insert > Page Number).

---

## Constraints

- Coordinates are **absolute from layout top** — not relative to part. Header objects at y=0–80, Body from y=80, Footer near the bottom.
- Rectangles and lines have no confirmed clipboard XML format — omit them and note they need manual addition in Layout Mode.
- The `Label` class must exist in `theme-classes.json`. If absent, flag it to the developer — they may need to create it in FM's theme editor first.
- Never use the `<LayoutObject>` SaXML format — it will not paste into FileMaker from the clipboard.
- Container fields (logo): `pictFormat="5"` = scale to fit, `graphicFormat="5"` in ExtendedAttributes.
