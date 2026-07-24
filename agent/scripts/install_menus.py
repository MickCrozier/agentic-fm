#!/usr/bin/env python3
"""
install_menus.py — Build and clipboard-load agentic-fm custom menu XML.

Usage:
  python agent/scripts/install_menus.py           # loads menus to clipboard
  python agent/scripts/install_menus.py --set     # loads menu set to clipboard

Reads from:
  agent/sandbox/custom_menus.xml           snapshot: catalog UUID, file header,
                                           and each menu's own UUID + ID
  agent/sandbox/custom_menu_set.xml        snapshot: set catalog UUID, set UUID + ID
  the agentic-fm plugin                    Agentic-fm Menu script ID (/api/context)

Writes:
  agent/sandbox/custom_menus.xml           ready to paste in FM (menus)
  agent/sandbox/custom_menu_set.xml        ready to paste in FM (set)

Create the snapshots by copying the menus (and the set) in FileMaker's
Manage > Custom Menus, then reading the clipboard back:
  python3 agent/scripts/agfm_bridge.py clipboard-read > agent/sandbox/custom_menus.xml

The snapshot files serve a dual purpose: source of the solution-specific UUIDs,
then overwritten with the fully populated output. Since every UUID is preserved
in the output, the script is idempotent.
"""

import re, os, sys, json, subprocess, argparse

SCRIPT_NAME    = 'Agentic-fm Menu'
TEMPLATE_MENUS = 'filemaker/custom_menu/custom_menus.xml'
TEMPLATE_SET   = 'filemaker/custom_menu/custom_menu_set.xml'
SNAPSHOT_MENUS = 'agent/sandbox/custom_menus.xml'
SNAPSHOT_SET   = 'agent/sandbox/custom_menu_set.xml'
MENU_NAMES     = ['File', 'Edit', 'Selection', 'Format', 'View']


def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def write_file(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)


def extract_menus_snapshot(path):
    """Return (file_name, file_uuid, catalog_uuid) from a custom menus snapshot."""
    c = read_file(path)
    file_name = re.search(r'<FMObjectTransfer[^>]+File="([^"]+)"', c).group(1)
    file_uuid = re.search(r'<FMObjectTransfer[^>]+UUID="([^"]+)"', c).group(1)
    cat_m = re.search(
        r'<CustomMenuCatalog[^>]*>\s*<UUID[^>]*>([A-F0-9-]{36})</UUID>',
        c, re.DOTALL | re.IGNORECASE
    )
    if not cat_m:
        sys.exit(f"CustomMenuCatalog UUID not found in {path}.\n"
                 f"Recreate by copying any custom menu from FileMaker and running:\n"
                 f"  python3 agent/scripts/agfm_bridge.py clipboard-read > {path}")
    return file_name, file_uuid, cat_m.group(1)


def extract_set_snapshot(path):
    """Return (set_catalog_uuid, set_uuid, standard_menus_uuid) from a menu set snapshot."""
    c = read_file(path)
    set_cat = re.search(
        r'<CustomMenuSetCatalog[^>]*>\s*<UUID[^>]*>([A-F0-9-]{36})</UUID>',
        c, re.DOTALL | re.IGNORECASE
    ).group(1)
    set_uuid = re.search(
        r'<CustomMenuSet[^>]*>\s*<UUID[^>]*>([A-F0-9-]{36})</UUID>',
        c, re.DOTALL | re.IGNORECASE
    ).group(1)
    std_m = re.search(r'CustomMenuSetReference[^>]+UUID="([A-F0-9-]{36})"', c, re.IGNORECASE)
    return set_cat, set_uuid, (std_m.group(1) if std_m else None)


def read_menu_info(path):
    """Return {menu_name: {id, uuid}} parsed from a multi-menu clipboard snapshot.

    A snapshot taken by selecting all five menus in Manage > Custom Menus contains
    one <CustomMenu name="..." id="..."> block per menu, each with its own <UUID>.
    """
    c = read_file(path)
    found = {}
    for m in re.finditer(
        r'<CustomMenu\s+name="([^"]+)"\s+id="(\d+)"[^>]*>\s*<UUID[^>]*>([A-F0-9-]{36})</UUID>',
        c, re.IGNORECASE
    ):
        found[m.group(1)] = {'id': m.group(2), 'uuid': m.group(3)}

    menus = {}
    for name in MENU_NAMES:
        key = f'agentic-fm \u2014 {name}'
        if key not in found:
            sys.exit(
                f"Menu not found in snapshot: {key}\n"
                f"Snapshot: {path}\n\n"
                f"In FileMaker, open Manage > Custom Menus, select all five "
                f"agentic-fm menus, copy them (Cmd+C), then run:\n"
                f"  python3 agent/scripts/agfm_bridge.py clipboard-read > {path}"
            )
        menus[name] = found[key]
    return menus


def read_set_info(path):
    """Return (set_id, set_name) from a menu set clipboard snapshot."""
    m = re.search(r'<CustomMenuSet\s+name="([^"]+)"\s+id="(\d+)"', read_file(path), re.IGNORECASE)
    if not m:
        sys.exit(
            f"CustomMenuSet not found in snapshot: {path}\n\n"
            f"In FileMaker, open Manage > Custom Menus, select the agentic-fm "
            f"menu set, copy it (Cmd+C), then run:\n"
            f"  python3 agent/scripts/agfm_bridge.py clipboard-read > {path}"
        )
    return m.group(2), m.group(1)


def find_script_id(name):
    """Look up a script ID from the plugin's live context."""
    try:
        out = subprocess.run(
            [sys.executable, 'agent/scripts/agfm_bridge.py', 'context'],
            capture_output=True, text=True, check=True,
        ).stdout
        scripts = json.loads(out).get('scripts', {})
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError) as exc:
        sys.exit(f"Could not read context from the plugin: {exc}\n"
                 f"The plugin is the only source of script IDs — check it is running:\n"
                 f"  python3 agent/scripts/agfm_bridge.py status")

    info = scripts.get(name)
    if not info or 'id' not in info:
        sys.exit(f"Script '{name}' not found in the solution.\n"
                 f"Install the bridge script first (see filemaker/custom_menu/README.md).")
    return str(info['id'])


def substitute(template, tokens):
    c = template
    for k, v in tokens.items():
        c = c.replace(f'{{{{{k}}}}}', v)
    remaining = re.findall(r'\{\{[A-Z_]+\}\}', c)
    if remaining:
        sys.exit(f"Unresolved tokens: {remaining}")
    return c


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--set', action='store_true',
                        help='Load menu set to clipboard instead of individual menus')
    args = parser.parse_args()

    # Validate snapshots exist
    required = [SNAPSHOT_MENUS] + ([SNAPSHOT_SET] if args.set else [])
    for path in required:
        if not os.path.exists(path):
            kind = "menu set" if 'set' in path else "custom menus"
            sys.exit(
                f"Snapshot not found: {path}\n\n"
                f"Create it by copying the {kind} from FileMaker (Manage > Custom Menus)\n"
                f"then running:\n"
                f"  python3 agent/scripts/agfm_bridge.py clipboard-read > {path}"
            )

    # Solution name comes from the snapshot's file header
    solution = re.search(
        r'<FMObjectTransfer[^>]+File="([^"]+)"', read_file(SNAPSHOT_MENUS)
    ).group(1)
    print(f"Solution: {solution}")

    menus = read_menu_info(SNAPSHOT_MENUS)
    script_id = find_script_id(SCRIPT_NAME)

    print(f"Script '{SCRIPT_NAME}': id={script_id}")
    for name, info in menus.items():
        print(f"  {name}: id={info['id']}, uuid={info['uuid']}")

    # Build shared token dict
    tokens = {'SCRIPT_ID': script_id}
    for name, info in menus.items():
        tok = name.upper()
        tokens[f'MENU_{tok}_ID']   = info['id']
        tokens[f'MENU_{tok}_UUID'] = info['uuid']

    if not args.set:
        file_name, file_uuid, cat_uuid = extract_menus_snapshot(SNAPSHOT_MENUS)
        print(f"File: {file_name}  Catalog UUID: {cat_uuid}")
        tokens.update({
            'FM_FILE_NAME': file_name,
            'FM_FILE_UUID': file_uuid,
            'CATALOG_UUID': cat_uuid,
        })
        output = substitute(read_file(TEMPLATE_MENUS), tokens)
        write_file(SNAPSHOT_MENUS, output)
        print(f"Written: {SNAPSHOT_MENUS}")
        subprocess.run([sys.executable, 'agent/scripts/agfm_bridge.py',
                        'clipboard-write', SNAPSHOT_MENUS], check=True)

    else:
        file_name, file_uuid, _ = extract_menus_snapshot(SNAPSHOT_MENUS)
        set_cat, set_uuid, std_uuid = extract_set_snapshot(SNAPSHOT_SET)

        set_id, set_name = read_set_info(SNAPSHOT_SET)
        print(f"Menu set: {set_name}")

        print(f"Set: id={set_id}, uuid={set_uuid}")
        tokens.update({
            'FM_FILE_NAME':       file_name,
            'FM_FILE_UUID':       file_uuid,
            'SET_CATALOG_UUID':   set_cat,
            'MENU_SET_UUID':      set_uuid,
            'MENU_SET_ID':        set_id,
            'STANDARD_MENUS_UUID': std_uuid or '00000000-0000-0000-0000-000000000000',
        })
        output = substitute(read_file(TEMPLATE_SET), tokens)
        write_file(SNAPSHOT_SET, output)
        print(f"Written: {SNAPSHOT_SET}")
        subprocess.run([sys.executable, 'agent/scripts/agfm_bridge.py', 'clipboard-write', SNAPSHOT_SET],
                       check=True)


if __name__ == '__main__':
    main()
