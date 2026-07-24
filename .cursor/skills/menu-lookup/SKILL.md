---
name: menu-lookup
description: Capture a FileMaker custom menu or menu set from the live solution via the plugin clipboard, and extract the real UUIDs required before creating or modifying any menu XML. Use when the user asks to create, modify, review, or look up a custom menu or menu set by name or ID.
---

# Menu Lookup

Capture a FileMaker custom menu or menu set from the live solution and extract the critical UUIDs required before any menu XML can be created or modified. **Without the correct UUIDs, FileMaker silently ignores paste operations.**

Custom menus are not exposed by any plugin API endpoint — there is no `/api/menus` and no discovery query for them. The only reliable source of real UUIDs is the FileMaker clipboard. This skill is therefore developer-assisted by design: you tell the developer exactly what to copy, then read it back through the plugin.

## Lookup workflow

### Step 1 — Check the sandbox first

```bash
ls agent/sandbox/{Solution}/
```

If a menu XML for this menu was captured earlier in the session, reuse it rather than asking the developer to copy again. Confirm with the developer that it is still current before relying on it.

### Step 2 — Ask the developer to copy the menu

Be specific about *which* object you need — a **CustomMenu** (an individual menu) and a **CustomMenuSet** (the per-layout container) are different objects with different UUIDs.

For an individual menu:

> I need the real UUIDs for the **{Menu Name}** menu — FileMaker ignores pastes with invented ones.
>
> 1. **File > Manage > Custom Menus**
> 2. Select **{Menu Name}** in the list
> 3. **⌘C**
>
> Let me know when that's done and I'll read it back.

For a menu set, direct them to the **Custom Menu Sets** tab of the same dialog instead.

### Step 3 — Read it back

```bash
python3 agent/scripts/agfm_bridge.py clipboard-read > "agent/sandbox/{Solution}/{MenuName}-original.xml"
```

Confirm the clipboard actually holds a menu — the XML root will be `<FMObjectTransfer>` containing either `<CustomMenuCatalog>` or `<CustomMenuSetCatalog>`. If you get script steps or layout objects instead, the developer copied the wrong thing; say so and ask again.

If the clipboard read fails to decode, re-digest it and retry:

```bash
curl -s -X POST -H "Authorization: Bearer $AGFM_PLUGIN_TOKEN" \
  "http://localhost:${AGFM_PLUGIN_PORT:-8766}/api/clipboard/digest"
```

### Step 4 — Menu match report + confirmation

Present the report and confirm in one response:

**Selected menu**
- Name: `{menu name}`
- ID: `{id}`
- Type: CustomMenu / CustomMenuSet

**Paths**
- Captured XML: `agent/sandbox/{Solution}/{MenuName}-original.xml`
- In-progress sandbox copy: `{path, or "none"}`

**Extracted UUIDs**
- Catalog UUID: `{UUID}`
- Menu/Set UUID: `{UUID}`
- Menu item count: `{N from MenuItemList membercount}`

Then confirm: "Is this the correct menu? — {Menu Name} (ID: {id})"

## Critical UUIDs — why they matter

FileMaker uses UUIDs to match pasted XML against existing objects in the solution. If either UUID is wrong or made up, the paste silently does nothing — no error, no change.

| UUID | Location in XML | Purpose |
|---|---|---|
| **CustomMenuCatalog UUID** | `<CustomMenuCatalog> > <UUID>` | Identifies the solution's menu catalog |
| **CustomMenu UUID** | `<CustomMenu> > <UUID>` | Identifies the specific menu to update |
| **CustomMenuSetCatalog UUID** | `<CustomMenuSetCatalog> > <UUID>` | Identifies the solution's menu set catalog |
| **CustomMenuSet UUID** | `<CustomMenuSet> > <UUID>` | Identifies the specific menu set to update |

Always read these from a clipboard capture of the live solution — never invent them, and never carry them over from a different file.

## Handoff: creating or modifying menu XML

Once confirmed:

### Modifying an existing menu

1. Use the captured XML in `agent/sandbox/{Solution}/` as the base.
2. Apply the requested changes following the structure in `agent/docs/CUSTOM_MENUS.md`.
3. Keep both the `CustomMenuCatalog UUID` and `CustomMenu UUID` from the original — do not regenerate them.
4. Write to clipboard: `python3 agent/scripts/agfm_bridge.py clipboard-write agent/sandbox/{Solution}/<menu>.xml`
5. Tell the developer: open **Manage > Custom Menus**, select the target menu, paste.

### Creating a new menu item block for an existing menu

1. Confirm the menu's real UUIDs from the match report above.
2. Build new `<CustomMenuItem>` elements using the patterns in `agent/docs/CUSTOM_MENUS.md`.
3. `CustomMenuItem UUID` and `hash` values can be placeholders — FileMaker reassigns them on paste.
4. Increment `MenuItemList membercount` to match the new total.
5. Write and paste as above.

### Creating a brand-new menu

A menu that doesn't exist yet has no UUIDs to capture. Create the shell in FileMaker first:

1. In FileMaker, create the empty menu in **Manage > Custom Menus** and name it.
2. Select it and **⌘C**.
3. Read it back: `python3 agent/scripts/agfm_bridge.py clipboard-read > agent/sandbox/{Solution}/<menu>-original.xml`
4. Use that file as the base — it now contains real UUIDs.
5. Build the menu XML from there following `agent/docs/CUSTOM_MENUS.md`.

## Key reference

Full XML patterns, shortcut modifier values, `<Override>` rules, `<Base>` element behavior, and the `ut16` clipboard format are documented in `agent/docs/CUSTOM_MENUS.md`.

## Examples

### Example 1 — Modifying an existing menu

User: "Add a Sort Lines item to the Format menu"

1. `ls agent/sandbox/{Solution}/` — no existing Format menu capture
2. Ask the developer to select **Format** in Manage > Custom Menus and press ⌘C
3. `agfm_bridge.py clipboard-read > agent/sandbox/{Solution}/Format-original.xml`
4. Report the extracted UUIDs and confirm the menu
5. On confirmation: add the new `<CustomMenuItem>` block, bump `membercount`, write to clipboard, tell the developer to paste

### Example 2 — Menu already captured this session

User: "Now add a Sort Descending item too"

1. `ls agent/sandbox/{Solution}/` — `Format-original.xml` is already there
2. Confirm with the developer that the menu hasn't changed in FileMaker since
3. Reuse the existing UUIDs — no second copy needed

### Example 3 — Brand-new menu

User: "Create a View menu"

1. `ls agent/sandbox/{Solution}/` — nothing found
2. Explain that a menu must exist in FileMaker before it can be populated: ask the developer to create an empty **View** menu, select it, and ⌘C
3. Read it back, then build the item blocks against its real UUIDs
