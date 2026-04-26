"""Documentation rules D001–D003 for FMLint.

These are tier-1 (offline) rules that check for proper script documentation
practices: description comments, parameter blocks, and section separation.
"""

from ..engine import rule, LintRule
from ..types import Diagnostic, Severity


# ---------------------------------------------------------------------------
# D001 — description-comment
# ---------------------------------------------------------------------------

@rule
class PurposeComment(LintRule):
    """First step should be a non-empty # (comment) describing the script."""

    rule_id = "D001"
    name = "description-comment"
    category = "documentation"
    default_severity = Severity.WARNING
    formats = {"xml", "hr"}
    tier = 1

    def check_xml(self, parse_result, catalog, context, config):
        if not parse_result.ok or not parse_result.steps:
            return []

        sev = self.severity(config)

        first = parse_result.steps[0]
        name = first.get("name", "")
        if name != "# (comment)":
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message="First step should be a # (comment) describing the script's purpose",
                line=1,
                fix_hint="Add a # (comment) step at the top with a one-line description",
            )]

        text_el = first.find("Text")
        text = text_el.text if text_el is not None and text_el.text else ""
        if not text.strip():
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message="First comment is blank — add a one-line description of the script's purpose",
                line=1,
                fix_hint="Replace the blank comment with a description",
            )]

        return []

    def check_hr(self, lines, catalog, context, config):
        sev = self.severity(config)

        # Find the first non-empty line
        first = None
        for ln in lines:
            if ln.raw.strip():
                first = ln
                break

        if first is None:
            return []

        if not first.is_comment:
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message="First step should be a # comment describing the script's purpose",
                line=first.line_number,
                fix_hint="Add a # comment at the top with a one-line description",
            )]

        if not first.comment_text.strip():
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message="First comment is blank — add a one-line description of the script's purpose",
                line=first.line_number,
                fix_hint="Replace the blank comment with a description",
            )]

        return []


# ---------------------------------------------------------------------------
# D002 — parameter-block
# ---------------------------------------------------------------------------

@rule
class ReadmeBlock(LintRule):
    """Scripts that read parameters should document them with a '# PARAMETERS' comment block."""

    rule_id = "D002"
    name = "parameter-block"
    category = "documentation"
    default_severity = Severity.INFO
    formats = {"xml", "hr"}
    tier = 1

    _PARAM_PATTERNS = ("Get ( ScriptParameter", "Get(ScriptParameter")
    _DOC_KEYWORDS = ("# PARAMETERS", "# PARAMETER")

    def check_xml(self, parse_result, catalog, context, config):
        if not parse_result.ok or not parse_result.steps:
            return []

        sev = self.severity(config)
        uses_param = False
        has_doc = False

        for step in parse_result.steps:
            for calc in step.iter("Calculation"):
                if calc.text and any(p in calc.text for p in self._PARAM_PATTERNS):
                    uses_param = True

            name = step.get("name", "")
            enabled = step.get("enable", "True")
            if name == "# (comment)" and enabled == "True":
                text_el = step.find("Text")
                text = text_el.text if text_el is not None and text_el.text else ""
                if any(kw.lstrip("# ").upper() in text.upper() for kw in self._DOC_KEYWORDS):
                    has_doc = True

        if uses_param and not has_doc:
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message=(
                    "Script uses Get(ScriptParameter) but has no # PARAMETERS comment block. "
                    "Add a # PARAMETERS section to the header."
                ),
                line=0,
            )]

        return []

    def check_hr(self, lines, catalog, context, config):
        sev = self.severity(config)
        uses_param = False
        has_doc = False

        for ln in lines:
            raw = ln.raw
            bracket = ln.bracket_content or ""

            if any(p in raw for p in self._PARAM_PATTERNS):
                uses_param = True
            if any(p in bracket for p in self._PARAM_PATTERNS):
                uses_param = True

            if ln.is_comment:
                text = ln.comment_text or ""
                if any(kw.lstrip("# ").upper() in text.upper() for kw in self._DOC_KEYWORDS):
                    has_doc = True

        if uses_param and not has_doc:
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message=(
                    "Script uses Get(ScriptParameter) but has no # PARAMETERS comment block. "
                    "Add a # PARAMETERS section to the header."
                ),
                line=0,
            )]

        return []


# ---------------------------------------------------------------------------
# D003 — section-separation
# ---------------------------------------------------------------------------

@rule
class SectionSeparation(LintRule):
    """Large scripts (>20 steps) should use blank comment lines as section separators."""

    rule_id = "D003"
    name = "section-separation"
    category = "documentation"
    default_severity = Severity.INFO
    formats = {"xml", "hr"}
    tier = 1

    def check_xml(self, parse_result, catalog, context, config):
        if not parse_result.ok:
            return []

        rc = self.rule_config(config)
        sev = self.severity(config)
        min_steps = rc.get("min_steps", 20)

        steps = parse_result.steps
        if len(steps) <= min_steps:
            return []

        blank_comments = 0
        for step in steps:
            name = step.get("name", "")
            if name == "# (comment)":
                text_el = step.find("Text")
                if text_el is None or not text_el.text or not text_el.text.strip():
                    blank_comments += 1

        if blank_comments == 0:
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message=(
                    f"Script has {len(steps)} steps but no blank comment lines "
                    "for section separation. Consider adding blank # (comment) "
                    "steps to visually separate logical sections."
                ),
                line=0,
            )]

        return []

    def check_hr(self, lines, catalog, context, config):
        rc = self.rule_config(config)
        sev = self.severity(config)
        min_steps = rc.get("min_steps", 20)

        # Count actual steps (non-empty lines that have a step_name or are comments)
        step_lines = [ln for ln in lines if ln.step_name or ln.is_comment]
        if len(step_lines) <= min_steps:
            return []

        blank_comments = 0
        for ln in lines:
            if ln.is_comment and not ln.comment_text:
                blank_comments += 1

        if blank_comments == 0:
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message=(
                    f"Script has {len(step_lines)} steps but no blank comment lines "
                    "for section separation. Consider adding blank # lines "
                    "to visually separate logical sections."
                ),
                line=0,
            )]

        return []
