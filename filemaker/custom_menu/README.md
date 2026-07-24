# Custom Menu Integration

This folder contains the files needed to add an editor-aware custom menu set to a FileMaker layout hosting the agentic-fm web viewer. This integration is **optional** — it adds five menus (File, Edit, Selection, Format, View) populated with editor keyboard shortcuts and actions that are routed through a bridge script to the Monaco editor.

| File                         | Type                    | Description                                                                                                  |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Agentic-fm Menu-script.xml` | fmxmlsnippet            | Bridge script that receives a menu action string as `Get(ScriptParameter)` and forwards it to the web viewer |
| `custom_menus.xml`           | FMObjectTransfer (ut16) | All 5 custom menus with their items                                                                          |
| `custom_menu_set.xml`        | FMObjectTransfer (ut16) | The `agentic-fm` menu set referencing the 5 menus                                                            |

---

## How it works

Each menu item calls a single bridge script — **Agentic-fm Menu** — passing a Monaco action ID as its parameter (e.g. `"editor.action.commentLine"` or `"agfm.newScript"`). The script passes that action through to the `agentic-fm` web viewer object on the layout via `Perform JavaScript in Web Viewer`.

The web viewer object on the target layout **must be named `agentic-fm`** for the bridge script to reach it.

---

## Prerequisites

- The agentic-fm web viewer is embedded on a layout with the object name `agentic-fm`
- The main agentic-fm scripts are already installed (see `filemaker/README.md`)
- The agentic-fm plugin is running and reachable (`python3 agent/scripts/agfm_bridge.py status`)

---

## Integration steps

Because FileMaker custom menus use solution-specific UUIDs and script IDs, the XML files in this folder cannot be pasted directly — an agent must substitute the correct values for your solution first.

### 1. Install the bridge script

Load the script onto the clipboard and paste it into your Script Workspace:

```bash
python3 agent/scripts/agfm_bridge.py clipboard-write "filemaker/custom_menu/Agentic-fm Menu-script.xml"
```

Switch to FileMaker, open **Scripts > Script Workspace**, click in the script list, and press **⌘V**. The **Agentic-fm Menu** script will appear.

The install script looks up the ID FileMaker assigns automatically via the plugin — you don't need to note it. To check it yourself:

```bash
python3 agent/scripts/agfm_bridge.py context | python3 -c "
import sys, json; print(json.load(sys.stdin)['scripts'].get('Agentic-fm Menu'))"
```

### 2. Create placeholder custom menus in FileMaker

FileMaker must assign UUIDs to the menus before their contents can be pasted. In FileMaker, go to **File > Manage > Custom Menus** and create five empty custom menus with **exactly these names**:

- `agentic-fm — File`
- `agentic-fm — Edit`
- `agentic-fm — Selection`
- `agentic-fm — Format`
- `agentic-fm — View`

Name spelling and dashes matter — the agent matches by name when looking up UUIDs.

### 3. Create the custom menu set

Still in Manage > Custom Menus, create a new custom menu set named **`agentic-fm`**. Add the five menus to it in this order:

1. agentic-fm — File
2. agentic-fm — Edit
3. agentic-fm — Selection
4. agentic-fm — Format
5. agentic-fm — View

Click **OK** to save and close.

### 4. Capture snapshots

With the placeholder menus and menu set still selected in FileMaker:

1. In **Manage > Custom Menus**, select **all five menus**, copy them (⌘C), then run:

```bash
python3 agent/scripts/agfm_bridge.py clipboard-read > agent/sandbox/custom_menus.xml
```

2. Select the **agentic-fm** menu set, copy it (⌘C), then run:

```bash
python3 agent/scripts/agfm_bridge.py clipboard-read > agent/sandbox/custom_menu_set.xml
```

These snapshots capture every solution-specific UUID and ID that FileMaker requires for paste operations — the catalog UUIDs, each menu's own UUID and ID, and the menu set's UUID and ID.

### 5. Run the install script

```bash
python3 agent/scripts/install_menus.py
```

The script reads the UUIDs and IDs from the snapshots, looks up the bridge script ID via the plugin, builds the populated XML, writes it back to `agent/sandbox/custom_menus.xml`, and loads it onto the clipboard.

### 6. Paste the custom menus

In FileMaker, open **File > Manage > Custom Menus**. Select the first menu in the list (`agentic-fm — File`), then press **⌘V**. Repeat for each of the five menus — FileMaker matches by UUID and populates each menu with its items.

### 7. Load and paste the menu set

```bash
python3 agent/scripts/install_menus.py --set
```

In FileMaker, select the **agentic-fm** menu set and press **⌘V**.

### 8. Assign the menu set to the layout

Switch to the layout that hosts the web viewer. Enter **Layout mode**, open **Layouts > Layout Setup**, and under **Menu Set** choose **agentic-fm**. Save the layout.

---

## Troubleshooting

**Paste does nothing** — The UUID in the XML does not match the solution. Make sure you captured the snapshots (step 4) *after* creating the menus in step 2, and that the UUIDs came from those snapshots rather than from the template files in this folder.

**Menu actions have no effect** — Confirm the web viewer object on the layout is named exactly `agentic-fm`. Check that the bridge script is installed and its name is **Agentic-fm Menu**.

**Wrong script called** — The `<Script id="...">` in `custom_menus.xml` still references the source solution's ID (271). Re-run `install_menus.py`; it resolves the ID from the plugin's live context each time.

---

For full technical details on the custom menu clipboard format, UUID requirements, and `<Override>` attribute rules, see `agent/docs/CUSTOM_MENUS.md`.
