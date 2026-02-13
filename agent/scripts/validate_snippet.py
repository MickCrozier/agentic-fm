#!/usr/bin/env python3
"""
Validate fmxmlsnippet files for common errors before pasting into FileMaker.

Checks:
  1. Well-formed XML
  2. Correct root element (<fmxmlsnippet type="FMObjectList">)
  3. No <Script> wrapper (output should be steps only)
  4. Step attributes (enable, id, name present on every <Step>)
  5. Paired steps balanced and properly nested (If/End If, Loop/End Loop, etc.)
  6. Else/Else If ordering within If blocks
  7. Known step names (cross-referenced against snippet_examples/)
  8. CONTEXT.json cross-reference (field, layout, and script references)

Usage:
  python validate_snippet.py [file_or_directory] [options]

Examples:
  python validate_snippet.py                          # validate all files in agent/sandbox/
  python validate_snippet.py agent/sandbox/MyScript   # validate a single file
  python validate_snippet.py --context agent/CONTEXT.json  # with reference checking
"""

import argparse
import json
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


# ---------------------------------------------------------------------------
# Paired-step definitions
# ---------------------------------------------------------------------------

PAIRED_STEPS = {
    "If":               {"closer": "End If"},
    "Loop":             {"closer": "End Loop"},
    "Open Transaction": {"closer": "Commit Transaction"},
}

# Steps that may only appear inside a specific block
BLOCK_INNER_STEPS = {
    "Else If":           "If",
    "Else":              "If",
    "Exit Loop If":      "Loop",
    "Revert Transaction": "Open Transaction",
}

# Reverse: closer name -> opener name
CLOSER_TO_OPENER = {v["closer"]: k for k, v in PAIRED_STEPS.items()}


# ---------------------------------------------------------------------------
# Result collector
# ---------------------------------------------------------------------------

class ValidationResult:
    """Collects pass, warning, and error messages for one file."""

    def __init__(self, filename):
        self.filename = filename
        self.errors = []
        self.warnings = []
        self.passes = []

    def error(self, msg):
        self.errors.append(msg)

    def warning(self, msg):
        self.warnings.append(msg)

    def passed(self, msg):
        self.passes.append(msg)

    @property
    def ok(self):
        return len(self.errors) == 0


# ---------------------------------------------------------------------------
# Discover known step names from snippet_examples/
# ---------------------------------------------------------------------------

def discover_known_steps(snippets_dir):
    """Scan snippet_examples/ XML files and return a set of known step names."""
    known = set()
    snippets_path = Path(snippets_dir)
    if not snippets_path.exists():
        return known

    for xml_file in snippets_path.rglob("*.xml"):
        try:
            tree = ET.parse(xml_file)
            for step in tree.getroot().findall(".//Step"):
                name = step.get("name")
                if name:
                    known.add(name)
        except ET.ParseError:
            # Fall back to the filename
            known.add(xml_file.stem)

    return known


# ---------------------------------------------------------------------------
# Load CONTEXT.json
# ---------------------------------------------------------------------------

def load_context(context_path):
    """Load CONTEXT.json and extract reference sets for cross-validation."""
    ctx = {
        "fields":  {},     # (to_name, field_name) -> str(field_id)
        "layouts": {},     # layout_name -> str(layout_id)
        "scripts": {},     # script_name -> str(script_id)
        "tables":  set(),  # table-occurrence names
    }

    if not context_path or not os.path.exists(context_path):
        return None

    with open(context_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for _base, info in data.get("tables", {}).items():
        to_name = info.get("to", _base)
        ctx["tables"].add(to_name)
        for field_name, field_info in info.get("fields", {}).items():
            ctx["fields"][(to_name, field_name)] = str(field_info.get("id", ""))

    for layout_name, layout_info in data.get("layouts", {}).items():
        ctx["layouts"][layout_name] = str(layout_info.get("id", ""))

    for script_name, script_info in data.get("scripts", {}).items():
        ctx["scripts"][script_name] = str(script_info.get("id", ""))

    return ctx


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

def check_root_element(root, result):
    """Verify the root element is <fmxmlsnippet type="FMObjectList">."""
    if root.tag != "fmxmlsnippet":
        result.error(f'Root element is <{root.tag}>, expected <fmxmlsnippet>')
    elif root.get("type") != "FMObjectList":
        result.error(f'Root type="{root.get("type")}", expected "FMObjectList"')
    else:
        result.passed("Correct root element")


def check_no_script_wrapper(root, result):
    """Output must not contain <Script> wrapper tags."""
    if root.findall(".//Script[@name]"):
        # Only flag Script elements that look like wrappers (have a name attr
        # and contain Step children), not <Script> references inside Perform
        # Script steps which have id/name but no Step children.
        wrappers = [
            s for s in root.findall(".//Script[@name]")
            if s.find("Step") is not None
        ]
        if wrappers:
            result.error("Contains <Script> wrapper -- output should be steps only")
            return
    result.passed("No <Script> wrapper")


def check_step_attributes(steps, result):
    """Every <Step> must have enable, id, and name attributes."""
    issues = []
    for i, step in enumerate(steps, 1):
        missing = [a for a in ("enable", "id", "name") if step.get(a) is None]
        if missing:
            issues.append(f'Step {i}: missing attribute(s) {", ".join(missing)}')

    if issues:
        for msg in issues:
            result.error(msg)
    elif steps:
        result.passed(f"All {len(steps)} step(s) have required attributes")


def check_paired_steps(steps, result):
    """Validate that paired steps are balanced and properly nested.

    Also enforces Else/Else If ordering:
      - Else If may appear any number of times after If (before Else)
      - Else may appear at most once, and only after all Else If steps
      - After Else, neither Else nor Else If may appear before End If
    """
    # Stack entries: (opener_name, step_number, seen_else)
    stack = []
    pair_errors = []

    for i, step in enumerate(steps, 1):
        name = step.get("name", "")

        # --- Opener ---
        if name in PAIRED_STEPS:
            stack.append({"opener": name, "step": i, "seen_else": False})

        # --- Closer ---
        elif name in CLOSER_TO_OPENER:
            expected_opener = CLOSER_TO_OPENER[name]
            if not stack:
                pair_errors.append(
                    f'Step {i}: "{name}" without matching "{expected_opener}"'
                )
            elif stack[-1]["opener"] != expected_opener:
                pair_errors.append(
                    f'Step {i}: "{name}" should close "{expected_opener}" but '
                    f'innermost open block is "{stack[-1]["opener"]}" '
                    f'(opened at step {stack[-1]["step"]})'
                )
            else:
                stack.pop()

        # --- Inner steps (Else, Else If, Exit Loop If, Revert Transaction) ---
        elif name in BLOCK_INNER_STEPS:
            required_opener = BLOCK_INNER_STEPS[name]

            # Find the nearest enclosing block of the required type
            enclosing = None
            for entry in reversed(stack):
                if entry["opener"] == required_opener:
                    enclosing = entry
                    break

            if enclosing is None:
                pair_errors.append(
                    f'Step {i}: "{name}" outside of a {required_opener} block'
                )
            elif name == "Else":
                if enclosing["seen_else"]:
                    pair_errors.append(
                        f'Step {i}: duplicate "Else" in If block '
                        f'(opened at step {enclosing["step"]})'
                    )
                else:
                    enclosing["seen_else"] = True
            elif name == "Else If":
                if enclosing["seen_else"]:
                    pair_errors.append(
                        f'Step {i}: "Else If" after "Else" in If block '
                        f'(opened at step {enclosing["step"]})'
                    )

    # Unclosed blocks
    for entry in stack:
        closer = PAIRED_STEPS[entry["opener"]]["closer"]
        pair_errors.append(
            f'Step {entry["step"]}: "{entry["opener"]}" never closed '
            f'(expected "{closer}")'
        )

    if pair_errors:
        for msg in pair_errors:
            result.error(msg)
    else:
        openers = sum(1 for s in steps if s.get("name", "") in PAIRED_STEPS)
        if openers:
            result.passed(f"Paired steps balanced ({openers} block(s))")
        else:
            result.passed("No paired steps to validate")


def check_known_step_names(steps, known_steps, result):
    """Warn when a step name is not found in snippet_examples."""
    unknown = []
    for i, step in enumerate(steps, 1):
        name = step.get("name", "")
        if name and name not in known_steps:
            unknown.append((i, name))

    if unknown:
        for step_num, name in unknown:
            result.warning(f'Step {step_num}: "{name}" not found in snippet_examples')
    elif steps:
        result.passed("All step names found in snippet_examples")


def check_context_references(steps, context, result):
    """Cross-reference Field, Layout, and Script elements against CONTEXT.json."""
    field_refs = []
    layout_refs = []
    script_refs = []

    for i, step in enumerate(steps, 1):
        # <Field table="X" id="N" name="Y"/>
        for el in step.findall(".//Field"):
            table = el.get("table", "")
            fname = el.get("name", "")
            fid = el.get("id", "0")
            if table and fname:
                field_refs.append((i, table, fname, fid))

        # <Layout id="N" name="Y"/>
        for el in step.findall(".//Layout"):
            lname = el.get("name", "")
            lid = el.get("id", "0")
            if lname:
                layout_refs.append((i, lname, lid))

        # <Script id="N" name="Y"/> inside Perform Script (not wrapper)
        for el in step.findall(".//Script"):
            if el.find("Step") is not None:
                continue  # wrapper, not a reference
            sname = el.get("name", "")
            sid = el.get("id", "0")
            if sname:
                script_refs.append((i, sname, sid))

    # --- Fields ---
    field_issues = 0
    for step_num, table, fname, fid in field_refs:
        key = (table, fname)
        if key in context["fields"]:
            expected = context["fields"][key]
            if fid != "0" and expected and fid != expected:
                result.warning(
                    f'Step {step_num}: Field "{table}::{fname}" id={fid}, '
                    f"CONTEXT.json has id={expected}"
                )
                field_issues += 1
        elif table not in context["tables"]:
            result.warning(
                f'Step {step_num}: Table "{table}" not in CONTEXT.json '
                "(may be defined outside the scoped context)"
            )
            field_issues += 1
        else:
            result.warning(
                f'Step {step_num}: Field "{table}::{fname}" not in CONTEXT.json'
            )
            field_issues += 1

    if field_refs and field_issues == 0:
        result.passed(
            f"All {len(field_refs)} field reference(s) verified against CONTEXT.json"
        )

    # --- Layouts ---
    layout_issues = 0
    for step_num, lname, lid in layout_refs:
        if lname in context["layouts"]:
            expected = context["layouts"][lname]
            if lid != "0" and expected and lid != expected:
                result.warning(
                    f'Step {step_num}: Layout "{lname}" id={lid}, '
                    f"CONTEXT.json has id={expected}"
                )
                layout_issues += 1
        else:
            result.warning(
                f'Step {step_num}: Layout "{lname}" not in CONTEXT.json'
            )
            layout_issues += 1

    if layout_refs and layout_issues == 0:
        result.passed(
            f"All {len(layout_refs)} layout reference(s) verified against CONTEXT.json"
        )

    # --- Scripts ---
    script_issues = 0
    for step_num, sname, sid in script_refs:
        if sname in context["scripts"]:
            expected = context["scripts"][sname]
            if sid != "0" and expected and sid != expected:
                result.warning(
                    f'Step {step_num}: Script "{sname}" id={sid}, '
                    f"CONTEXT.json has id={expected}"
                )
                script_issues += 1
        else:
            result.warning(
                f'Step {step_num}: Script "{sname}" not in CONTEXT.json'
            )
            script_issues += 1

    if script_refs and script_issues == 0:
        result.passed(
            f"All {len(script_refs)} script reference(s) verified against CONTEXT.json"
        )


# ---------------------------------------------------------------------------
# Main validation driver
# ---------------------------------------------------------------------------

def validate_file(filepath, known_steps=None, context=None):
    """Run all checks against a single fmxmlsnippet file."""
    result = ValidationResult(filepath)

    # 1. Well-formed XML
    try:
        tree = ET.parse(filepath)
        root = tree.getroot()
        result.passed("Well-formed XML")
    except ET.ParseError as e:
        result.error(f"Malformed XML: {e}")
        return result  # nothing else can run without a parse tree

    # 2. Root element
    check_root_element(root, result)

    # 3. No <Script> wrapper
    check_no_script_wrapper(root, result)

    # 4. Step attributes
    steps = root.findall(".//Step")
    if not steps:
        result.warning("No <Step> elements found in file")
    check_step_attributes(steps, result)

    # 5 & 6. Paired steps + ordering
    check_paired_steps(steps, result)

    # 7. Known step names
    if known_steps:
        check_known_step_names(steps, known_steps, result)

    # 8. CONTEXT.json cross-reference
    if context:
        check_context_references(steps, context, result)

    return result


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

def print_result(result, quiet=False):
    """Print validation results with formatting."""
    print(f"\n{'=' * 60}")
    print(f"  {result.filename}")
    print(f"{'=' * 60}")

    if not quiet:
        for msg in result.passes:
            print(f"  PASS  {msg}")

    for msg in result.warnings:
        print(f"  WARN  {msg}")

    for msg in result.errors:
        print(f"  FAIL  {msg}")

    total_checks = len(result.passes) + len(result.errors)
    if result.ok:
        summary = f"PASSED ({total_checks} check(s) passed"
        if result.warnings:
            summary += f", {len(result.warnings)} warning(s)"
        summary += ")"
    else:
        summary = f"FAILED ({len(result.errors)} error(s)"
        if result.warnings:
            summary += f", {len(result.warnings)} warning(s)"
        summary += ")"

    print(f"\n  {summary}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Validate fmxmlsnippet files for common errors"
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=None,
        help="File or directory to validate (default: agent/sandbox/)",
    )
    parser.add_argument(
        "--context",
        default=None,
        help="Path to CONTEXT.json for reference validation",
    )
    parser.add_argument(
        "--snippets",
        default=None,
        help="Path to snippet_examples/ directory",
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Only show errors and warnings",
    )

    args = parser.parse_args()

    # Resolve project root (this script lives in agent/scripts/)
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent.parent

    # Resolve paths with sensible defaults
    target = Path(args.path) if args.path else project_root / "agent" / "sandbox"
    snippets_dir = (
        Path(args.snippets)
        if args.snippets
        else project_root / "agent" / "snippet_examples"
    )
    context_path = Path(args.context) if args.context else None

    # Auto-detect CONTEXT.json when not specified
    if context_path is None:
        default_ctx = project_root / "agent" / "CONTEXT.json"
        if default_ctx.exists():
            context_path = default_ctx

    # Discover known step names
    known_steps = discover_known_steps(snippets_dir)
    if known_steps:
        print(f"Loaded {len(known_steps)} known step names from snippet_examples")
    else:
        print(f"Warning: no snippet_examples found at {snippets_dir}")

    # Load CONTEXT.json
    context = None
    if context_path:
        context = load_context(context_path)
        if context:
            print(f"Loaded CONTEXT.json from {context_path}")
        else:
            print(f"Warning: could not load CONTEXT.json from {context_path}")

    # Collect files
    files = []
    if target.is_file():
        files.append(target)
    elif target.is_dir():
        for f in sorted(target.iterdir()):
            if f.is_file() and not f.name.startswith("."):
                files.append(f)
    else:
        print(f"Error: {target} does not exist")
        sys.exit(1)

    if not files:
        print(f"No files found in {target}")
        sys.exit(0)

    # Run validation
    results = []
    for filepath in files:
        r = validate_file(filepath, known_steps, context)
        results.append(r)
        print_result(r, args.quiet)

    # Summary
    failed_count = sum(1 for r in results if not r.ok)
    print(f"\n{'─' * 60}")
    print(f"  {len(results)} file(s) validated: ", end="")
    if failed_count == 0:
        print("ALL PASSED")
    else:
        print(f"{failed_count} FAILED, {len(results) - failed_count} passed")
    print()

    sys.exit(0 if failed_count == 0 else 1)


if __name__ == "__main__":
    main()
