# Layout Design Conventions

This document governs how the layout editor AI assistant designs and modifies FileMaker layouts. Apply these conventions to all layout-patch operations and design recommendations.

---

## Context available in this session

The AI chat has access to:

- **Current layout state** — all objects currently on the canvas (fields, buttons, text, portals, etc.) with their IDs, positions, and sizes
- **Available fields** — fields from the layout's base TO and all directly related TOs, listed in the "Available Fields" section of this prompt
- **Layout instructions** — any custom instructions set by the developer in AI Settings

What is NOT automatically available:
- Value lists — read the `value_lists` section of `GET /api/context`
- Script names — read the `scripts` section of `GET /api/context`

---

## Discovering context

When a request requires information not in the available fields list, fetch it from the plugin:

**Value lists**: read the `value_lists` section of `GET /api/context` (`agfm_bridge.py context`).

**Scripts for buttons**: read the `scripts` section of `GET /api/context`, or `agfm_bridge.py discovery-query scripts` for the full roster.

**Additional related tables**: if a table isn't in the field list it may not be related to this layout's TO. Confirm with `POST /api/query` against `FileMaker_Tables`, or ask the developer to navigate to a layout where it is in scope.

**Theme classes**: not exposed by the plugin. Ask the developer for a class name from the Inspector.

---

## Layout types

| Type | Purpose | Key characteristics |
|------|---------|---------------------|
| **Detail view** | View/edit a single record | Sections of fields, related portals at bottom |
| **List view** | Browse records | Repeating body, column headers in header part |
| **Card window** | Modal task or picker | Compact, fixed dimensions, focused |
| **Dashboard** | Overview / metrics | Summary fields, buttons, minimal data entry |
| **Print layout** | Report output | Precise positioning, sub-summary parts |

---

## Spacing and sizing

### Standard field row

| Element | Height | Notes |
|---------|--------|-------|
| Field | 22px | Standard edit box |
| Label | 20px | Vertically centred beside field |
| Row gap | 8px | Between rows |
| Section gap | 20px | Between logical sections |

### Standard widths

| Purpose | Width |
|---------|-------|
| Short label | 100px |
| Medium label | 140px |
| Short field (code, status) | 100px |
| Medium field (name, email) | 200px |
| Wide field (address, notes) | 340px |
| Full-width field | Canvas width − (2 × margin) |

### Margins

- Left/right body margin: **20px**
- Top body margin: **20px** below part top
- Keep fields left-aligned within sections

---

## Two-column field layout

The standard pattern for a detail view body:

```
[Label]        [Field                    ]
[Label]        [Field                    ]
```

- Label width: 120px, right-aligned text, vertically centred
- Gap between label and field: 8px
- Field starts at: label_left + label_width + gap

When placing a label+field pair at row `y`:
- Label: `x=20, y=y, width=120, height=20`
- Field: `x=148, y=y, width=200, height=22`
- Next row: `y += 30` (22px field + 8px gap)

---

## Sections

Group related fields with a section header above:

```
[Section Title text]       ← y = section_top
[Label] [Field]            ← y = section_top + 24
[Label] [Field]            ← y = section_top + 54
...
```

Section header text: bold, font size 11–12pt, text colour from theme neutral/heading class.

---

## Portals

Portal conventions:

- **Header row**: Text label objects placed *above* the portal at the same x positions as the portal columns — not inside the portal
- **Portal position**: Row height 22px; first data row offset = 0 from portal top
- **Visible rows**: Set based on available space. Common: 5–8 rows
- **Scroll bar**: Always include vertical scroll bar for portals with variable record counts
- **Width**: Typically full body width or a defined column grid

Portal child field x-positions are relative to the portal's left edge. Column widths should sum to the portal width.

Example portal with 3 columns at portal width 600px:
```
Column 1: x=0,   width=200  (Description)
Column 2: x=200, width=100  (Quantity)
Column 3: x=300, width=100  (Unit Price)
Column 4: x=400, width=100  (Line Total)
Column 5: x=500, width=100  (Status)
```

---

## Buttons

- **Primary action** (Save, Submit): top-right of layout, or bottom-right of card
- **Secondary action** (Cancel, Close): left of primary, same row
- **Destructive action** (Delete): separated from primary actions, typically bottom-left
- **Navigation**: header or top navigation part
- Standard button size: width 80–120px, height 28px

---

## Value list fields

When a field uses a value list (e.g. Status, Type, Category):

- Use a **drop-down list** for 5+ values or when free-text is also valid
- Use **radio buttons** for 2–4 mutually exclusive options with short labels
- Use a **drop-down calendar** for Date fields where appropriate
- Checkbox sets for multi-select (rare in FM — usually a separate related table is better)

To wire a value list to a field, the developer must set it in FileMaker Layout Mode. In the layout editor, add the field and note in the chat that it needs a value list applied.

---

## Conditional formatting

Cannot be applied via the layout editor — it requires FileMaker Layout Mode. When a field needs conditional formatting:

1. Add the field normally via layout-patch
2. Note to the developer: "Apply conditional formatting in FM Layout Mode > Format > Conditional"

Common patterns:
- Status "Overdue" → red text
- Status "Paid" / "Complete" → green text or muted
- Empty required field → yellow background

---

## Theme classes (use these by preference)

**Always prefer theme style classes over custom CSS.** Objects exported without a theme class get FM's bare default appearance. Objects with a named theme class inherit the solution's full visual language — borders, fills, fonts, hover states — automatically.

When adding or styling objects via layout-patch, always include `themeClass` using a class name from the **Theme Classes** section of this prompt. Do not invent or guess class names — only use names that appear in that list. If no theme class list is available, ask the developer:

> "What theme class should I use? Check the Inspector panel when a similar field is selected."

**Do not use internal type names** (`edit_box`, `text_box`, `portal`, `button`, `line`, `rectangle`) as theme classes — these are FM internal identifiers, not theme style classes, and will not apply any styling.

### Theme class in layout-patch

```json
{ "op": "style", "id": "<objectId>", "themeClass": "field-control-bd" }
```

Or set it at add time:

```json
{ "op": "add", "object": { "type": "field", "fieldRef": "Invoice::Status", "themeClass": "field-control-bd", ... } }
```

Objects without a `themeClass` paste into FileMaker with no style applied (plain default). Always specify one when you know it.

---

## Layout parts

Standard part heights:

| Part | Typical height | Contents |
|------|---------------|---------|
| Top Navigation | 44px | App navigation, logo |
| Header | 60–80px | Layout title, action buttons, search |
| Body | Variable | Fields, portals, content |
| Footer | 30–40px | Status bar, record count, paging |

Body height: set to contain all content with 20px bottom padding.

---

## Design principles

- **Left-align field left edges** within a section — never ragged
- **Vertically centre labels** relative to their associated field
- **Group related data** — contact info together, financial data together
- **Primary data at top** — most-referenced fields first, secondary/audit fields last
- **Portals at the bottom** of the body, after all header fields
- **One logical thing per portal** — don't mix unrelated related records in one portal
- **Don't crowd** — prefer whitespace over packing in more fields
- **Don't add visual separators between layout parts** — where sections are separated by parts (Header, Body, Footer, etc.), do not add rectangles, lines, or other decorative separators. The part boundary itself defines the section break.
