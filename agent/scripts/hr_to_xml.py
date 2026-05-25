#!/usr/bin/env python3
"""
hr_to_xml.py — Convert human-readable .fmscript to fmxmlsnippet XML.

Local fallback converter for when the AGFM plugin is unavailable.
For production use, prefer the plugin's /api/hr-to-xml endpoint — it has
live solution context and resolves field/layout/script IDs correctly.

This converter always emits id="0" for field, layout, and script references.
FileMaker resolves these by name on paste as long as the objects exist.

Usage:
    python3 agent/scripts/hr_to_xml.py <input.fmscript>
    python3 agent/scripts/hr_to_xml.py <input.fmscript> --output <output.xml>
    python3 agent/scripts/hr_to_xml.py <input.fmscript> --script-name "My Script" --bundle
"""

import json
import os
import re
import sys
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# HR parser (mirrors agent/fmlint/formats/hr_parser.py)
# ---------------------------------------------------------------------------

@dataclass
class ParsedLine:
    raw: str
    line_number: int
    disabled: bool = False
    is_empty: bool = False
    is_comment: bool = False
    comment_text: str = ""
    step_name: str = ""
    bracket_content: str = ""
    params: list = field(default_factory=list)


def _merge_multiline(lines: list) -> list:
    """Join continuation lines when brackets span multiple lines."""
    out = []
    accumulator = ""
    start_line = 1
    bracket_depth = 0
    in_quote = False

    for i, line in enumerate(lines):
        trimmed = line.strip()

        if bracket_depth == 0 and (trimmed.startswith("#") or trimmed == ""):
            out.append((line, i + 1))
            continue

        if bracket_depth == 0:
            accumulator = line
            start_line = i + 1
        else:
            accumulator += "\n" + line

        for ch in line:
            if ch == '"':
                in_quote = not in_quote
                continue
            if in_quote:
                continue
            if ch == "[":
                bracket_depth += 1
            elif ch == "]":
                bracket_depth -= 1

        if bracket_depth <= 0:
            out.append((accumulator, start_line))
            accumulator = ""
            bracket_depth = 0
            in_quote = False

    if accumulator:
        out.append((accumulator, start_line))
    return out


def _find_top_level_bracket(text: str) -> int:
    in_quote = False
    for i, ch in enumerate(text):
        if ch == '"':
            in_quote = not in_quote
        if not in_quote and ch == "[":
            return i
    return -1


def _find_matching_bracket(text: str, open_idx: int) -> int:
    depth = 0
    in_quote = False
    for i in range(open_idx, len(text)):
        ch = text[i]
        if ch == '"':
            in_quote = not in_quote
        if in_quote:
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _split_params(content: str) -> list:
    """Split by ; respecting quotes, parens, and brackets."""
    params = []
    current = ""
    in_quote = False
    paren_depth = 0
    bracket_depth = 0

    for ch in content:
        if ch == '"':
            in_quote = not in_quote
            current += ch
            continue
        if in_quote:
            current += ch
            continue
        if ch == "(":
            paren_depth += 1
        elif ch == ")":
            paren_depth -= 1
        elif ch == "[":
            bracket_depth += 1
        elif ch == "]":
            bracket_depth -= 1
        if ch == ";" and paren_depth == 0 and bracket_depth == 0:
            params.append(current.strip())
            current = ""
            continue
        current += ch

    if current.strip():
        params.append(current.strip())
    return params


def _parse_line(raw: str, line_number: int) -> ParsedLine:
    trimmed = raw.strip()

    if not trimmed:
        return ParsedLine(raw=raw, line_number=line_number, is_empty=True)

    # Doc-block comment: # at start of non-indented line
    if trimmed.startswith("#"):
        comment_text = trimmed[1:].strip()
        return ParsedLine(
            raw=raw, line_number=line_number,
            is_comment=True, comment_text=comment_text, step_name="# (comment)",
        )

    disabled = False
    work = trimmed
    if trimmed.startswith("//"):
        disabled = True
        work = trimmed[2:].strip()
        if work.startswith("#"):
            comment_text = work[1:].strip()
            return ParsedLine(
                raw=raw, line_number=line_number, disabled=True,
                is_comment=True, comment_text=comment_text, step_name="# (comment)",
            )

    bracket_idx = _find_top_level_bracket(work)
    if bracket_idx >= 0:
        step_name = work[:bracket_idx].strip()
        close_bracket = _find_matching_bracket(work, bracket_idx)
        if close_bracket >= 0:
            bracket_content = work[bracket_idx + 1:close_bracket].strip()
        else:
            bracket_content = work[bracket_idx + 1:].strip()
        bracket_content = re.sub(r'\s+', ' ', bracket_content).strip()
        params = _split_params(bracket_content)
    else:
        step_name = work.strip()
        bracket_content = ""
        params = []

    return ParsedLine(
        raw=raw, line_number=line_number, disabled=disabled,
        step_name=step_name, bracket_content=bracket_content, params=params,
    )


def parse_hr(text: str) -> list:
    raw_lines = text.splitlines()
    merged = _merge_multiline(raw_lines)
    return [_parse_line(raw, lnum) for raw, lnum in merged]


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

def _load_catalog() -> dict:
    here = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        candidate = os.path.normpath(os.path.join(here, '..', 'catalogs', 'step-catalog-en.json'))
        if os.path.isfile(candidate):
            with open(candidate, encoding='utf-8') as fp:
                entries = json.load(fp)
            return {e['name']: e for e in entries if 'name' in e}
        here = os.path.dirname(here)
    return {}


CATALOG = _load_catalog()


# ---------------------------------------------------------------------------
# XML helpers
# ---------------------------------------------------------------------------

def _cdata(text: str) -> str:
    return f'<![CDATA[{text or ""}]]>'


def _esc(text: str) -> str:
    if not text:
        return ''
    return (text.replace('&', '&amp;')
                .replace('<', '&lt;')
                .replace('>', '&gt;')
                .replace('"', '&quot;'))


def _calc_el(text: str, wrapper: str = '') -> str:
    inner = f'<Calculation>{_cdata(text)}</Calculation>'
    return f'<{wrapper}>{inner}</{wrapper}>' if wrapper else inner


def _field_el(ref: str, tag: str = 'Field') -> str:
    """Emit <Field table="TO" id="0" name="Field"/> from 'TO::Field', or variable/bare name."""
    ref = ref.strip()
    if '::' in ref:
        table, fname = ref.split('::', 1)
        return f'<{tag} table="{_esc(table.strip())}" id="0" name="{_esc(fname.strip())}"/>'
    return f'<{tag}>{_esc(ref)}</{tag}>'


def _on_off(val: str) -> str:
    return 'True' if val.strip().lower() in ('on', 'true', 'yes') else 'False'


def _split_label(param: str):
    """Split 'Label: value' at first top-level ': '. Returns ('', param) if no label."""
    in_quote = False
    paren = 0
    for i, ch in enumerate(param):
        if ch == '"':
            in_quote = not in_quote
        if in_quote:
            continue
        if ch == '(':
            paren += 1
        elif ch == ')':
            paren -= 1
        if ch == ':' and paren == 0 and i + 1 < len(param) and param[i + 1] == ' ':
            return param[:i].strip(), param[i + 2:].strip()
    return '', param


def _labeled_dict(params: list):
    """Return ({label: value}, [positional]) from params list."""
    labeled = {}
    positional = []
    for p in params:
        label, value = _split_label(p)
        if label:
            labeled[label] = value
        else:
            positional.append(p)
    return labeled, positional


# ---------------------------------------------------------------------------
# Hand-coded step emitters — return list of inner XML lines
# ---------------------------------------------------------------------------

def _emit_comment(pl: ParsedLine) -> list:
    if not pl.comment_text:
        return []
    return [f'<Text>{_esc(pl.comment_text)}</Text>']


def _emit_if(pl: ParsedLine) -> list:
    return [_calc_el(pl.bracket_content)]


def _emit_else_if(pl: ParsedLine) -> list:
    return [_calc_el(pl.bracket_content)]


def _emit_exit_loop_if(pl: ParsedLine) -> list:
    return [_calc_el(pl.bracket_content)]


def _emit_exit_script(pl: ParsedLine) -> list:
    content = pl.bracket_content
    _, value = _split_label(content) if ': ' in content else ('', content)
    value = value or content
    return [_calc_el(value)] if value else []


def _emit_set_variable(pl: ParsedLine) -> list:
    params = pl.params
    if not params:
        return []

    name_part = params[0].strip()
    rep = ''
    rep_match = re.match(r'^(.+)\[(.+)\]$', name_part)
    if rep_match:
        name_part = rep_match.group(1).strip()
        rep = rep_match.group(2).strip()

    value = ''
    if len(params) >= 2:
        _, value = _split_label(params[1])

    lines = [f'<Name>{_esc(name_part)}</Name>']
    lines.append(f'<Value>{_calc_el(value)}</Value>')
    if rep:
        lines.append(f'<Repetition>{_calc_el(rep)}</Repetition>')
    return lines


def _emit_allow_user_abort(pl: ParsedLine) -> list:
    val = pl.params[0] if pl.params else 'On'
    return [f'<Set state="{_on_off(val)}"/>']


def _emit_set_error_capture(pl: ParsedLine) -> list:
    val = pl.params[0] if pl.params else 'On'
    return [f'<Set state="{_on_off(val)}"/>']


def _emit_perform_script(pl: ParsedLine) -> list:
    labeled, positional = _labeled_dict(pl.params)
    lines = []

    script_name = ''
    for p in positional:
        stripped = p.strip()
        if stripped.startswith('"') and stripped.endswith('"'):
            script_name = stripped[1:-1]
        # 'From list' token is informational, skip it

    param_calc = labeled.get('Parameter', labeled.get('Param', ''))

    if script_name:
        lines.append(f'<Script id="0" name="{_esc(script_name)}"/>')
    if param_calc:
        lines.append(_calc_el(param_calc))
    return lines


def _emit_set_field(pl: ParsedLine) -> list:
    params = pl.params
    if not params:
        return []
    lines = [_field_el(params[0])]
    if len(params) >= 2:
        lines.append(_calc_el(params[1]))
    return lines


def _emit_go_to_layout(pl: ParsedLine) -> list:
    content = pl.bracket_content.strip()
    if content.lower() == 'original layout':
        return ['<LayoutDestination value="OriginalLayout"/>']
    # First param is: "Layout Name" (TO_Name) — extract just the quoted name
    first = pl.params[0] if pl.params else content
    name_match = re.match(r'^"([^"]*)"', first.strip())
    if name_match:
        name = name_match.group(1)
    else:
        name = first.split('(')[0].strip().strip('"')
    return [
        '<LayoutDestination value="LayoutByName"/>',
        f'<Layout id="0" name="{_esc(name)}"/>',
        '<Animation value="None"/>',
    ]


def _emit_show_custom_dialog(pl: ParsedLine) -> list:
    labeled, _ = _labeled_dict(pl.params)
    lines = []
    if 'Title' in labeled:
        lines.append(f'<Title>{_calc_el(labeled["Title"])}</Title>')
    if 'Message' in labeled:
        lines.append(f'<Message>{_calc_el(labeled["Message"])}</Message>')
    return lines


def _emit_commit_records(pl: ParsedLine) -> list:
    labeled, _ = _labeled_dict(pl.params)
    dialog = labeled.get('With dialog', 'Off')
    no_interact = 'True' if dialog.strip().lower() == 'off' else 'False'
    return [f'<NoInteract state="{no_interact}"/>']


def _emit_go_to_object(pl: ParsedLine) -> list:
    labeled, positional = _labeled_dict(pl.params)
    name = labeled.get('Object Name', positional[0] if positional else '').strip('"')
    return [f'<ObjectName>{_calc_el(name)}</ObjectName>']


def _emit_new_window(pl: ParsedLine) -> list:
    labeled, _ = _labeled_dict(pl.params)
    lines = []
    style = labeled.get('Style', 'Document')
    lines.append(f'<NewWndStyles Style="{_esc(style)}"/>')
    if 'Name' in labeled:
        lines.append(f'<Name>{_calc_el(labeled["Name"])}</Name>')
    if 'Layout' in labeled:
        lname = labeled['Layout'].strip('"')
        lines.append(f'<Layout id="0" name="{_esc(lname)}"/>')
    if 'Height' in labeled:
        lines.append(f'<Height>{_calc_el(labeled["Height"])}</Height>')
    if 'Width' in labeled:
        lines.append(f'<Width>{_calc_el(labeled["Width"])}</Width>')
    return lines


def _emit_close_window(pl: ParsedLine) -> list:
    labeled, _ = _labeled_dict(pl.params)
    if 'Name' in labeled:
        return [
            '<Window value="ByName"/>',
            f'<Name>{_calc_el(labeled["Name"])}</Name>',
        ]
    return ['<Window value="Current"/>']


def _emit_insert_text(pl: ParsedLine) -> list:
    params = pl.params
    lines = ['<SelectAll state="False"/>']
    if len(params) >= 2:
        lines.append(f'<Text>{_esc(params[1])}</Text>')
        lines.append(_field_el(params[0]))
    elif len(params) == 1:
        lines.append(f'<Text>{_esc(params[0])}</Text>')
    return lines


EMITTERS = {
    '# (comment)': _emit_comment,
    'If': _emit_if,
    'Else If': _emit_else_if,
    'Exit Loop If': _emit_exit_loop_if,
    'Exit Script': _emit_exit_script,
    'Set Variable': _emit_set_variable,
    'Allow User Abort': _emit_allow_user_abort,
    'Set Error Capture': _emit_set_error_capture,
    'Perform Script': _emit_perform_script,
    'Set Field': _emit_set_field,
    'Go to Layout': _emit_go_to_layout,
    'Show Custom Dialog': _emit_show_custom_dialog,
    'Commit Records/Requests': _emit_commit_records,
    'Go to Object': _emit_go_to_object,
    'New Window': _emit_new_window,
    'Close Window': _emit_close_window,
    'Insert Text': _emit_insert_text,
}


# ---------------------------------------------------------------------------
# Generic catalog-driven emitter
# ---------------------------------------------------------------------------

def _emit_generic(pl: ParsedLine, entry: dict) -> list:
    """Emit inner XML for any step using its catalog param definitions."""
    params_spec = entry.get('params', [])
    if not params_spec:
        return []

    labeled, positional = _labeled_dict(pl.params)
    pos_idx = 0
    lines = []

    for spec in params_spec:
        hr_label = spec.get('hrLabel', '')
        p_type = spec.get('type', '')
        xml_el = spec.get('xmlElement', '')
        wrapper = spec.get('wrapperElement', '')
        xml_attr = spec.get('xmlAttr', 'value')
        default = spec.get('defaultValue', '')

        # Resolve raw value from HR params
        if hr_label and hr_label in labeled:
            raw = labeled[hr_label]
        elif hr_label and hr_label in pl.params:
            # Standalone label (flagElement present as bare word)
            raw = 'On'
        elif not hr_label and pos_idx < len(positional):
            raw = positional[pos_idx]
            pos_idx += 1
        elif default:
            raw = default
        else:
            continue

        if not raw:
            continue

        # Emit XML element based on type
        if p_type in ('calculation', 'calc'):
            inner = _calc_el(raw, wrapper) if wrapper else _calc_el(raw)
            if xml_el and xml_el != 'Calculation':
                lines.append(f'<{xml_el}>{inner}</{xml_el}>')
            else:
                lines.append(inner)

        elif p_type == 'namedCalc':
            inner = _calc_el(raw)
            wrap = wrapper or xml_el
            lines.append(f'<{wrap}>{inner}</{wrap}>')

        elif p_type == 'boolean':
            state = _on_off(raw)
            if xml_el:
                lines.append(f'<{xml_el} {xml_attr}="{state}"/>')

        elif p_type == 'flagElement':
            present = raw.strip().lower() in ('on', 'true', 'yes')
            if present and xml_el:
                lines.append(f'<{xml_el}/>')

        elif p_type == 'enum':
            if xml_el:
                lines.append(f'<{xml_el} {xml_attr}="{_esc(raw)}"/>')

        elif p_type == 'text':
            if xml_el:
                lines.append(f'<{xml_el}>{_esc(raw)}</{xml_el}>')

        elif p_type == 'field':
            lines.append(_field_el(raw, xml_el or 'Field'))

        elif p_type == 'layout':
            name = raw.strip('"').split('(')[0].strip()
            lines.append(f'<{xml_el or "Layout"} id="0" name="{_esc(name)}"/>')

        elif p_type == 'script':
            name = raw.strip('"')
            lines.append(f'<{xml_el or "Script"} id="0" name="{_esc(name)}"/>')

        else:
            # Unrecognised type — emit as text element
            if xml_el:
                lines.append(f'<{xml_el}>{_esc(raw)}</{xml_el}>')

    return lines


# ---------------------------------------------------------------------------
# Step → XML
# ---------------------------------------------------------------------------

def _step_to_xml(pl: ParsedLine) -> str:
    """Convert a ParsedLine to a <Step> XML string."""
    name = pl.step_name
    enabled = not pl.disabled
    enable_attr = 'True' if enabled else 'False'

    entry = CATALOG.get(name, {})
    step_id = entry.get('id', 0)
    self_closing = entry.get('selfClosing', False)

    # Dispatch to hand-coded emitter or generic
    emitter = EMITTERS.get(name)
    if emitter:
        inner_lines = emitter(pl)
    else:
        inner_lines = _emit_generic(pl, entry)

    # Build output
    open_tag = f'<Step enable="{enable_attr}" id="{step_id}" name="{_esc(name)}"'
    if not inner_lines and self_closing:
        return open_tag + '/>'
    if not inner_lines:
        return open_tag + '/>'

    parts = [open_tag + '>']
    for line in inner_lines:
        parts.append(f'  {line}')
    parts.append('</Step>')
    return '\n'.join(parts)


# ---------------------------------------------------------------------------
# Main converter
# ---------------------------------------------------------------------------

def hr_to_xml(text: str) -> str:
    """Convert HR script text to fmxmlsnippet XML string."""
    lines = parse_hr(text)
    step_parts = []

    for pl in lines:
        if pl.is_empty:
            continue
        if not pl.step_name:
            continue

        xml = _step_to_xml(pl)
        step_parts.append(xml)

    steps_xml = '\n'.join(step_parts)
    return f'<fmxmlsnippet type="FMObjectList">\n{steps_xml}\n</fmxmlsnippet>'


def hr_to_xml_bundle(text: str, script_name: str) -> str:
    """Wrap in a full <Script> object for creating a new script via paste."""
    inner = hr_to_xml(text)
    # Extract just the Step elements
    steps_match = re.search(
        r'<fmxmlsnippet[^>]*>(.*)</fmxmlsnippet>', inner, re.DOTALL
    )
    steps_body = steps_match.group(1).strip() if steps_match else ''

    return (
        f'<fmxmlsnippet type="FMObjectList">\n'
        f'<Script id="0" name="{_esc(script_name)}">\n'
        f'{steps_body}\n'
        f'</Script>\n'
        f'</fmxmlsnippet>'
    )


def convert_file(path: str, script_name: str = '', bundle: bool = False) -> str:
    with open(path, encoding='utf-8') as fp:
        text = fp.read()

    if bundle:
        name = script_name or os.path.splitext(os.path.basename(path))[0]
        return hr_to_xml_bundle(text, name)
    return hr_to_xml(text)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(
        description='Convert human-readable .fmscript to fmxmlsnippet XML.'
    )
    parser.add_argument('input', help='Path to .fmscript file')
    parser.add_argument('--output', '-o', help='Write XML to file instead of stdout')
    parser.add_argument('--bundle', action='store_true',
                        help='Wrap in a <Script> object for creating a new script via paste')
    parser.add_argument('--script-name', default='',
                        help='Script name for --bundle (defaults to filename stem)')
    args = parser.parse_args()

    result = convert_file(args.input, script_name=args.script_name, bundle=args.bundle)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(result)
            f.write('\n')
        print(f'Written to {args.output}', file=sys.stderr)
    else:
        print(result)
