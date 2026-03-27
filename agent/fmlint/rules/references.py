"""Reference validation rules R001–R009 for FMLint.

These are tier-2 (context-dependent) rules that validate field, layout,
script, and table-occurrence references against CONTEXT.json.
"""

import re
from datetime import datetime, timezone, timedelta

from ..engine import rule, LintRule
from ..types import Diagnostic, Severity


# ---------------------------------------------------------------------------
# R001 — field-exists
# ---------------------------------------------------------------------------

@rule
class FieldExists(LintRule):
    """Field references should exist in CONTEXT.json."""

    rule_id = "R001"
    name = "field-exists"
    category = "references"
    default_severity = Severity.WARNING
    formats = {"xml", "hr"}
    tier = 2

    _TO_FIELD_RE = re.compile(r'(\w+)::(\w+)')

    def check_xml(self, parse_result, catalog, context, config):
        if not context.available or not parse_result.ok:
            return []

        sev = self.severity(config)
        diags = []
        for idx, step in enumerate(parse_result.steps):
            for field_el in step.iter("Field"):
                table = field_el.get("table", "")
                name = field_el.get("name", "")
                if not table or not name:
                    continue
                self._check_field_ref(table, name, idx + 1, context, sev, diags)

        return diags

    def check_hr(self, lines, catalog, context, config):
        if not context.available:
            return []

        sev = self.severity(config)
        diags = []
        for ln in lines:
            content = ln.bracket_content or ""
            if not content:
                continue
            for match in self._TO_FIELD_RE.finditer(content):
                table = match.group(1)
                field_name = match.group(2)
                self._check_field_ref(table, field_name, ln.line_number, context, sev, diags)

        return diags

    def _check_field_ref(self, table, field_name, line, context, sev, diags):
        """Check a single field reference, emitting R001 or R007 as appropriate."""
        if table not in context.tables:
            # Table occurrence itself is unknown — emit R007
            diags.append(Diagnostic(
                rule_id="R007",
                severity=sev,
                message=f'Unknown table occurrence "{table}" in field reference "{table}::{field_name}"',
                line=line,
            ))
            return

        if (table, field_name) not in context.fields:
            diags.append(Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message=f'Field "{table}::{field_name}" not found in CONTEXT.json',
                line=line,
            ))


# ---------------------------------------------------------------------------
# R002 — field-id-match
# ---------------------------------------------------------------------------

@rule
class FieldIdMatch(LintRule):
    """Field IDs in XML should match CONTEXT.json."""

    rule_id = "R002"
    name = "field-id-match"
    category = "references"
    default_severity = Severity.WARNING
    formats = {"xml"}
    tier = 2

    def check_xml(self, parse_result, catalog, context, config):
        if not context.available or not parse_result.ok:
            return []

        sev = self.severity(config)
        diags = []
        for idx, step in enumerate(parse_result.steps):
            for field_el in step.iter("Field"):
                field_id = field_el.get("id", "0")
                if field_id == "0":
                    continue  # ID 0 means auto-assign

                table = field_el.get("table", "")
                name = field_el.get("name", "")
                if not table or not name:
                    continue

                expected_id = context.fields.get((table, name))
                if expected_id and expected_id != field_id:
                    diags.append(Diagnostic(
                        rule_id=self.rule_id,
                        severity=sev,
                        message=(
                            f'Field "{table}::{name}" has id="{field_id}" '
                            f'but CONTEXT.json says id="{expected_id}"'
                        ),
                        line=idx + 1,
                    ))

        return diags


# ---------------------------------------------------------------------------
# R003 — layout-exists
# ---------------------------------------------------------------------------

@rule
class LayoutExists(LintRule):
    """Layout references should exist in CONTEXT.json."""

    rule_id = "R003"
    name = "layout-exists"
    category = "references"
    default_severity = Severity.WARNING
    formats = {"xml", "hr"}
    tier = 2

    def check_xml(self, parse_result, catalog, context, config):
        if not context.available or not parse_result.ok:
            return []

        sev = self.severity(config)
        diags = []
        for idx, step in enumerate(parse_result.steps):
            for layout_el in step.iter("Layout"):
                name = layout_el.get("name", "")
                if not name:
                    continue
                if name not in context.layouts:
                    diags.append(Diagnostic(
                        rule_id=self.rule_id,
                        severity=sev,
                        message=f'Layout "{name}" not found in CONTEXT.json',
                        line=idx + 1,
                    ))

        return diags

    def check_hr(self, lines, catalog, context, config):
        if not context.available:
            return []

        sev = self.severity(config)
        diags = []
        for ln in lines:
            if ln.step_name != "Go to Layout":
                continue
            # Extract layout name from params or bracket_content
            layout_name = self._extract_layout_name(ln)
            if layout_name and layout_name not in context.layouts:
                diags.append(Diagnostic(
                    rule_id=self.rule_id,
                    severity=sev,
                    message=f'Layout "{layout_name}" not found in CONTEXT.json',
                    line=ln.line_number,
                ))

        return diags

    def _extract_layout_name(self, ln):
        """Extract layout name from HR line bracket content."""
        content = ln.bracket_content or ""
        if not content:
            return None
        # HR format: Go to Layout [ "Layout Name" (TableOccurrence) ]
        # or: Go to Layout [ "Layout Name" ]
        stripped = content.strip().strip('"').strip("'")
        # Remove table occurrence suffix if present
        paren_pos = stripped.find(" (")
        if paren_pos > 0:
            stripped = stripped[:paren_pos]
        # Remove surrounding quotes
        stripped = stripped.strip('"').strip("'")
        return stripped if stripped else None


# ---------------------------------------------------------------------------
# R004 — layout-id-match
# ---------------------------------------------------------------------------

@rule
class LayoutIdMatch(LintRule):
    """Layout IDs in XML should match CONTEXT.json."""

    rule_id = "R004"
    name = "layout-id-match"
    category = "references"
    default_severity = Severity.WARNING
    formats = {"xml"}
    tier = 2

    def check_xml(self, parse_result, catalog, context, config):
        if not context.available or not parse_result.ok:
            return []

        sev = self.severity(config)
        diags = []
        for idx, step in enumerate(parse_result.steps):
            for layout_el in step.iter("Layout"):
                layout_id = layout_el.get("id", "0")
                if layout_id == "0":
                    continue

                name = layout_el.get("name", "")
                if not name:
                    continue

                expected_id = context.layouts.get(name)
                if expected_id and expected_id != layout_id:
                    diags.append(Diagnostic(
                        rule_id=self.rule_id,
                        severity=sev,
                        message=(
                            f'Layout "{name}" has id="{layout_id}" '
                            f'but CONTEXT.json says id="{expected_id}"'
                        ),
                        line=idx + 1,
                    ))

        return diags


# ---------------------------------------------------------------------------
# R005 — script-exists
# ---------------------------------------------------------------------------

@rule
class ScriptExists(LintRule):
    """Script references should exist in CONTEXT.json."""

    rule_id = "R005"
    name = "script-exists"
    category = "references"
    default_severity = Severity.WARNING
    formats = {"xml", "hr"}
    tier = 2

    def check_xml(self, parse_result, catalog, context, config):
        if not context.available or not parse_result.ok:
            return []

        sev = self.severity(config)
        diags = []
        for idx, step in enumerate(parse_result.steps):
            for script_el in step.iter("Script"):
                # Skip Script elements that contain Step children — those are
                # script wrappers, not references
                if script_el.find("Step") is not None:
                    continue
                name = script_el.get("name", "")
                if not name:
                    continue
                if name not in context.scripts:
                    diags.append(Diagnostic(
                        rule_id=self.rule_id,
                        severity=sev,
                        message=f'Script "{name}" not found in CONTEXT.json',
                        line=idx + 1,
                    ))

        return diags

    def check_hr(self, lines, catalog, context, config):
        if not context.available:
            return []

        sev = self.severity(config)
        diags = []
        for ln in lines:
            if ln.step_name != "Perform Script":
                continue
            script_name = self._extract_script_name(ln)
            if script_name and script_name not in context.scripts:
                diags.append(Diagnostic(
                    rule_id=self.rule_id,
                    severity=sev,
                    message=f'Script "{script_name}" not found in CONTEXT.json',
                    line=ln.line_number,
                ))

        return diags

    def _extract_script_name(self, ln):
        """Extract script name from HR line bracket content."""
        content = ln.bracket_content or ""
        if not content:
            return None
        # HR format: Perform Script [ "Script Name" ; Parameter: ... ]
        stripped = content.strip()
        # Remove surrounding quotes and extract name before semicolon
        semi_pos = stripped.find(";")
        if semi_pos > 0:
            stripped = stripped[:semi_pos].strip()
        stripped = stripped.strip('"').strip("'")
        return stripped if stripped else None


# ---------------------------------------------------------------------------
# R006 — script-id-match
# ---------------------------------------------------------------------------

@rule
class ScriptIdMatch(LintRule):
    """Script IDs in XML should match CONTEXT.json."""

    rule_id = "R006"
    name = "script-id-match"
    category = "references"
    default_severity = Severity.WARNING
    formats = {"xml"}
    tier = 2

    def check_xml(self, parse_result, catalog, context, config):
        if not context.available or not parse_result.ok:
            return []

        sev = self.severity(config)
        diags = []
        for idx, step in enumerate(parse_result.steps):
            for script_el in step.iter("Script"):
                if script_el.find("Step") is not None:
                    continue

                script_id = script_el.get("id", "0")
                if script_id == "0":
                    continue

                name = script_el.get("name", "")
                if not name:
                    continue

                expected_id = context.scripts.get(name)
                if expected_id and expected_id != script_id:
                    diags.append(Diagnostic(
                        rule_id=self.rule_id,
                        severity=sev,
                        message=(
                            f'Script "{name}" has id="{script_id}" '
                            f'but CONTEXT.json says id="{expected_id}"'
                        ),
                        line=idx + 1,
                    ))

        return diags


# ---------------------------------------------------------------------------
# R007 — table-occurrence
# ---------------------------------------------------------------------------

@rule
class TableOccurrence(LintRule):
    """Table occurrence names in field references should be valid.

    Note: The actual checking logic is handled by R001 (FieldExists), which
    emits R007 diagnostics when the table occurrence itself is unknown. This
    class exists to register R007 in the rule registry so it can be
    independently enabled/disabled.
    """

    rule_id = "R007"
    name = "table-occurrence"
    category = "references"
    default_severity = Severity.WARNING
    formats = {"xml", "hr"}
    tier = 2

    # R001 handles the actual checks and emits R007 diagnostics when the
    # table occurrence is unrecognised.  This rule class is intentionally
    # a no-op — its registration allows config-level enable/disable.

    def check_xml(self, parse_result, catalog, context, config):
        return []

    def check_hr(self, lines, catalog, context, config):
        return []


# ---------------------------------------------------------------------------
# R008 — context-staleness
# ---------------------------------------------------------------------------

@rule
class ContextStaleness(LintRule):
    """Warn when CONTEXT.json is older than the configured threshold."""

    rule_id = "R008"
    name = "context-staleness"
    category = "references"
    default_severity = Severity.WARNING
    formats = {"xml", "hr"}
    tier = 2

    def _check(self, context, config):
        if not context.available or not context.generated_at:
            return []

        rc = self.rule_config(config)
        sev = self.severity(config)
        stale_minutes = rc.get("stale_minutes", 60)

        try:
            # Parse ISO 8601 timestamp from CONTEXT.json
            gen_str = context.generated_at
            # Handle common formats: "2025-01-15T10:30:00Z" or "2025-01-15 10:30:00"
            gen_str = gen_str.replace("Z", "+00:00")
            if "T" in gen_str:
                generated = datetime.fromisoformat(gen_str)
            else:
                generated = datetime.fromisoformat(gen_str)

            # Ensure timezone-aware comparison
            if generated.tzinfo is None:
                generated = generated.replace(tzinfo=timezone.utc)

            now = datetime.now(timezone.utc)
            age = now - generated
            threshold = timedelta(minutes=stale_minutes)

            if age > threshold:
                age_minutes = int(age.total_seconds() / 60)
                return [Diagnostic(
                    rule_id=self.rule_id,
                    severity=sev,
                    message=(
                        f"CONTEXT.json is {age_minutes} minutes old "
                        f"(threshold: {stale_minutes} min). "
                        "Consider running Push Context to refresh."
                    ),
                    line=0,
                    fix_hint="Run Push Context in FileMaker to refresh CONTEXT.json",
                )]
        except (ValueError, TypeError):
            # Can't parse the timestamp — skip silently
            pass

        return []

    def check_xml(self, parse_result, catalog, context, config):
        return self._check(context, config)

    def check_hr(self, lines, catalog, context, config):
        return self._check(context, config)


# ---------------------------------------------------------------------------
# R009 — scope-mismatch
# ---------------------------------------------------------------------------

@rule
class ScopeMismatch(LintRule):
    """References that exist in index files but not in CONTEXT.json scope.

    Stub — returns empty for now. Can be enhanced later to cross-reference
    index files and flag references that are valid in the solution but
    outside the current CONTEXT.json scope.
    """

    rule_id = "R009"
    name = "scope-mismatch"
    category = "references"
    default_severity = Severity.INFO
    formats = {"xml", "hr"}
    tier = 2

    def check_xml(self, parse_result, catalog, context, config):
        return []

    def check_hr(self, lines, catalog, context, config):
        return []
