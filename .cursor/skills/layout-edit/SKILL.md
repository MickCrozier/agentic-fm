---
name: layout-edit
description: Directly modify the live layout editor app by reading its current state, applying changes, and pushing the updated state back. The app reflects changes within 1-2 seconds. Use when the developer asks to add, move, resize, delete, or restyle objects in the layout editor — especially when they want to drive the editor from this Claude Code session rather than the in-app chat.
---

# Layout Edit

Modify the live layout editor app via its state sync API. The workflow is:
1. GET current state from the editor
2. Apply the requested changes to the JSON
3. POST the modified state back — the app picks it up within 1.5s

---

## API endpoints

The layout editor dev server runs on port **8081**. From inside the dev container, use `localhost:8081`. From the host machine, use the forwarded port.

```bash
# Read current layout state
curl -s http://localhost:8081/api/state

# Push modified state — app applies it within 1.5s
curl -s -X POST http://localhost:8081/api/state/incoming \
  -H "Content-Type: application/json" \
  -d @/tmp/layout_state.json
```

If the GET returns `{"error":"No state received from client yet"}`, the browser tab with the layout editor is not open or hasn't loaded yet. Ask the developer to open the layout editor in the browser first.

---

## LayoutState schema

```typescript
interface LayoutState {
  width: number;           // canvas width in px
  parts: LayoutPart[];     // layout bands (Header, Body, Footer, etc.)
  objects: LayoutObject[]; // all top-level layout objects
  popoverPanels: LayoutObject[]; // popover panel objects (appended at canvas root)
}

interface LayoutPart {
  type: string;   // e.g. "Header", "Body", "Footer", "TopNavigation"
  bottom: number; // y-coordinate of the bottom edge of this part (cumulative)
}

interface LayoutObject {
  id: string;          // internal UUID — preserve exactly
  fmId: string;        // FM object key — preserve exactly
  fmName: string;      // named object reference
  type: FMObjectType;  // 'field' | 'text' | 'button' | 'rectangle' | 'line' | 'portal' | etc.
  bounds: { top: number; left: number; bottom: number; right: number };
  x: number;           // same as bounds.left
  y: number;           // same as bounds.top
  width: number;       // bounds.right - bounds.left
  height: number;      // bounds.bottom - bounds.top
  displayText?: string;
  fieldRef?: string;   // "TableOccurrence::FieldName"
  themeClass?: string;
  localStyles?: object;
  children?: LayoutObject[];  // portal columns, group members, tab panels
  tabPanels?: { label: string; children: LayoutObject[] }[];
  controlStyle?: 'drop-down-list' | 'drop-down-calendar' | 'pop-up-menu' | 'checkbox-set' | 'radio-button-set';
  // ... other optional fields
}
```

**Important geometry rule**: when you move or resize an object, you must update `x`, `y`, `width`, `height` AND `bounds` to stay consistent:
- `bounds.left = x`, `bounds.top = y`
- `bounds.right = x + width`, `bounds.bottom = y + height`

---

## Step 1: Fetch current state

```bash
curl -s http://localhost:8081/api/state > /tmp/layout_state.json
cat /tmp/layout_state.json
```

Read and parse the JSON to understand the current objects and their positions. If the response is an error, stop and tell the developer to open the layout editor in a browser tab.

---

## Step 2: Apply the requested changes

Modify the JSON in memory (or write a modified copy to `/tmp/layout_state_modified.json`). Common operations:

### Move an object
Update `x`, `y`, `bounds.left`, `bounds.top`, `bounds.right` (= x + width), `bounds.bottom` (= y + height).

### Resize an object
Update `width`, `height`, `bounds.right`, `bounds.bottom`.

### Change display text
Update `displayText`.

### Change field binding
Update `fieldRef` (format: `"TableOccurrence::FieldName"`).

### Add a new object
Append a new object to `objects`. Generate a unique `id` (UUID format, e.g. use `python3 -c "import uuid; print(uuid.uuid4())"`). Set `fmId` to `"0"` and `fmName` to `""` for new objects. Set all required fields: `type`, `x`, `y`, `width`, `height`, `bounds`.

Minimum required fields for a new object:
```json
{
  "id": "<new-uuid>",
  "fmId": "0",
  "fmName": "",
  "type": "text",
  "bounds": { "top": 100, "left": 20, "bottom": 120, "right": 200 },
  "x": 20,
  "y": 100,
  "width": 180,
  "height": 20,
  "displayText": "Label text"
}
```

### Delete an object
Remove the object from the `objects` array (match by `id`).

### Apply a theme style class
Set `themeClass` to a valid class name from the solution's `theme-classes.json`.

### Change part height
Update the `bottom` value on the relevant `LayoutPart`. Also shift the `y` / `bounds.top` / `bounds.bottom` of any objects in parts below the changed part.

---

## Step 3: Push the modified state

```bash
curl -s -X POST http://localhost:8081/api/state/incoming \
  -H "Content-Type: application/json" \
  -d @/tmp/layout_state_modified.json
```

A successful response is `{"ok":true}`. The app will apply the state within ~1.5 seconds.

---

## Step 4: Confirm and iterate

After pushing, describe what changed. If the developer wants further adjustments, repeat from Step 1 (re-fetch the current state — it will now reflect the previous change).

---

## Working with Python for complex edits

For bulk edits (e.g., reflow all objects, apply a grid, batch rename), write a short Python script to `agent/sandbox/` rather than hand-editing the JSON:

```python
import json, uuid

with open('/tmp/layout_state.json') as f:
    state = json.load(f)

# ... transform state ...

with open('/tmp/layout_state_modified.json', 'w') as f:
    json.dump(state, f, indent=2)
```

Then push with the curl command above.

---

## Constraints

- Always re-fetch state before each edit session — the state in memory may be stale if the developer has made changes in the browser.
- Preserve all `id` and `fmId` values exactly — they are internal references used by the app.
- When geometry changes, keep `x`/`y`/`width`/`height` and `bounds` in sync.
- The editor displays changes live — no save step needed. Changes are in-memory only; to persist to XML use the app's Export button or the `/api/export` endpoint if available.
- New objects added via this API will not have FM-assigned IDs until pasted into FileMaker via the export flow.
