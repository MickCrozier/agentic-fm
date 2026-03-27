"""Best-practice rules B001–B005 for FMLint.

These are tier-1 (offline) rules that check for common FileMaker scripting
best practices: error handling, commit-before-nav, parameter validation,
exit script results, and invalid ternary operators.
"""

import re

from ..engine import rule, LintRule
from ..types import Diagnostic, Severity


# ---------------------------------------------------------------------------
# B001 — error-capture-paired
# ---------------------------------------------------------------------------

@rule
class ErrorCapturePaired(LintRule):
    """Set Error Capture [On] should be followed by a Get(LastError) check."""

    rule_id = "B001"
    name = "error-capture-paired"
    category = "best_practices"
    default_severity = Severity.WARNING
    formats = {"xml", "hr"}
    tier = 1

    _LAST_ERROR_PATTERNS = ("Get ( LastError", "Get(LastError")

    def check_xml(self, parse_result, catalog, context, config):
        if not parse_result.ok:
            return []

        rc = self.rule_config(config)
        sev = self.severity(config)
        lookahead = rc.get("lookahead_steps", 10)

        diags = []
        steps = parse_result.steps

        for idx, step in enumerate(steps):
            name = step.get("name", "")
            if name != "Set Error Capture":
                continue

            # Check if this is Set Error Capture [On]
            # (We warn for any Set Error Capture — if it's [Off] that's fine
            # but paired checking still makes sense for [On])
            state_el = step.find("State")
            if state_el is not None and state_el.get("state") == "False":
                continue  # This is [Off], skip

            # Look ahead up to lookahead steps for Get(LastError)
            found = False
            end = min(idx + 1 + lookahead, len(steps))
            for ahead_idx in range(idx + 1, end):
                ahead_step = steps[ahead_idx]
                for calc in ahead_step.iter("Calculation"):
                    if calc.text and any(p in calc.text for p in self._LAST_ERROR_PATTERNS):
                        found = True
                        break
                if found:
                    break

            if not found:
                diags.append(Diagnostic(
                    rule_id=self.rule_id,
                    severity=sev,
                    message=(
                        "Set Error Capture [On] without a subsequent "
                        "Get(LastError) check within the next "
                        f"{lookahead} steps"
                    ),
                    line=idx + 1,
                    fix_hint="Add an If [ Get ( LastError ) <> 0 ] check after the error-prone step",
                ))

        return diags

    def check_hr(self, lines, catalog, context, config):
        rc = self.rule_config(config)
        sev = self.severity(config)
        lookahead = rc.get("lookahead_steps", 10)

        diags = []
        step_lines = [ln for ln in lines if ln.step_name or ln.is_comment]

        for i, ln in enumerate(step_lines):
            if ln.step_name != "Set Error Capture":
                continue

            # Check if it's [Off]
            bracket = ln.bracket_content or ""
            if "Off" in bracket:
                continue

            # Look ahead up to lookahead step lines for Get(LastError)
            found = False
            end = min(i + 1 + lookahead, len(step_lines))
            for ahead_idx in range(i + 1, end):
                ahead_ln = step_lines[ahead_idx]
                content = ahead_ln.bracket_content or ""
                raw = ahead_ln.raw or ""
                if any(p in content or p in raw for p in self._LAST_ERROR_PATTERNS):
                    found = True
                    break

            if not found:
                diags.append(Diagnostic(
                    rule_id=self.rule_id,
                    severity=sev,
                    message=(
                        "Set Error Capture [On] without a subsequent "
                        "Get(LastError) check within the next "
                        f"{lookahead} steps"
                    ),
                    line=ln.line_number,
                    fix_hint="Add an If [ Get ( LastError ) <> 0 ] check after the error-prone step",
                ))

        return diags


# ---------------------------------------------------------------------------
# B002 — commit-before-nav
# ---------------------------------------------------------------------------

@rule
class CommitBeforeNav(LintRule):
    """Go to Layout should ideally be preceded by Commit Records somewhere in the script."""

    rule_id = "B002"
    name = "commit-before-nav"
    category = "best_practices"
    default_severity = Severity.INFO
    formats = {"xml", "hr"}
    tier = 1

    def check_xml(self, parse_result, catalog, context, config):
        if not parse_result.ok or not parse_result.steps:
            return []

        sev = self.severity(config)
        has_goto_layout = False
        has_commit = False

        for step in parse_result.steps:
            name = step.get("name", "")
            if name == "Go to Layout":
                has_goto_layout = True
            if name in ("Commit Records/Requests", "Commit Records"):
                has_commit = True

        if has_goto_layout and not has_commit:
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message=(
                    "Script navigates to a layout but never commits records. "
                    "Consider adding Commit Records/Requests before navigation "
                    "to avoid losing uncommitted edits."
                ),
                line=0,
                fix_hint="Add a Commit Records/Requests step before Go to Layout",
            )]

        return []

    def check_hr(self, lines, catalog, context, config):
        sev = self.severity(config)
        has_goto_layout = False
        has_commit = False

        for ln in lines:
            if ln.step_name == "Go to Layout":
                has_goto_layout = True
            if ln.step_name in ("Commit Records/Requests", "Commit Records"):
                has_commit = True

        if has_goto_layout and not has_commit:
            return [Diagnostic(
                rule_id=self.rule_id,
                severity=sev,
                message=(
                    "Script navigates to a layout but never commits records. "
                    "Consider adding Commit Records/Requests before navigation "
                    "to avoid losing uncommitted edits."
                ),
                line=0,
                fix_hint="Add a Commit Records/Requests step before Go to Layout",
            )]

        return []


# ---------------------------------------------------------------------------
# B003 — param-validation
# ---------------------------------------------------------------------------

@rule
class ParamValidation(LintRule):
    """Scripts that use Get(ScriptParameter) should validate the parameter.

    Stub — returns empty for now. Full implementation would check whether
    the script validates the parameter value early in the script flow.
    """

    rule_id = "B003"
    name = "param-validation"
    category = "best_practices"
    default_severity = Severity.INFO
    formats = {"xml", "hr"}
    tier = 1

    def check_xml(self, parse_result, catalog, context, config):
        return []

    def check_hr(self, lines, catalog, context, config):
        return []


# ---------------------------------------------------------------------------
# B004 — exit-script-result
# ---------------------------------------------------------------------------

@rule
class ExitScriptResult(LintRule):
    """Scripts should Exit Script with a result."""

    rule_id = "B004"
    name = "exit-script-result"
    category = "best_practices"
    default_severity = Severity.INFO
    formats = {"xml", "hr"}
    tier = 1

    def check_xml(self, parse_result, catalog, context, config):
        if not parse_result.ok or not parse_result.steps:
            return []

        sev = self.severity(config)
        for step in parse_result.steps:
            if step.get("name", "") == "Exit Script":
                return []

        return [Diagnostic(
            rule_id=self.rule_id,
            severity=sev,
            message=(
                "Script has no Exit Script step. Consider adding "
                "Exit Script with a result to communicate success/failure "
                "to calling scripts."
            ),
            line=0,
            fix_hint="Add an Exit Script [ Result: ... ] step",
        )]

    def check_hr(self, lines, catalog, context, config):
        sev = self.severity(config)
        for ln in lines:
            if ln.step_name == "Exit Script":
                return []

        # Only flag if there are actual steps
        has_steps = any(ln.step_name for ln in lines)
        if not has_steps:
            return []

        return [Diagnostic(
            rule_id=self.rule_id,
            severity=sev,
            message=(
                "Script has no Exit Script step. Consider adding "
                "Exit Script with a result to communicate success/failure "
                "to calling scripts."
            ),
            line=0,
            fix_hint="Add an Exit Script [ Result: ... ] step",
        )]


# ---------------------------------------------------------------------------
# B005 — no-ternary
# ---------------------------------------------------------------------------

@rule
class NoTernary(LintRule):
    """FileMaker does not support the ternary ? : operator in calculations."""

    rule_id = "B005"
    name = "no-ternary"
    category = "best_practices"
    default_severity = Severity.ERROR
    formats = {"xml", "hr"}
    tier = 1

    # Match a ? that is not inside a string literal, preceded by non-? and
    # followed by non-?. This is a heuristic — the ? character has no valid
    # use in FileMaker calculations outside of string literals.
    _TERNARY_RE = re.compile(r'\?')

    def _strip_strings(self, text):
        """Remove quoted string literals to avoid false positives."""
        # Remove "..." strings (FM uses double-quote for strings)
        result = re.sub(r'"[^"]*"', '""', text)
        return result

    def _has_ternary(self, text):
        """Check if text contains a likely ternary ? operator."""
        stripped = self._strip_strings(text)
        # Look for ? character — FM calcs never use ? outside strings
        return bool(self._TERNARY_RE.search(stripped))

    def check_xml(self, parse_result, catalog, context, config):
        if not parse_result.ok:
            return []

        sev = self.severity(config)
        diags = []
        for idx, step in enumerate(parse_result.steps):
            for calc in step.iter("Calculation"):
                if calc.text and self._has_ternary(calc.text):
                    diags.append(Diagnostic(
                        rule_id=self.rule_id,
                        severity=sev,
                        message=(
                            'Calculation contains "?" — FileMaker does not '
                            "support the ternary ? : operator"
                        ),
                        line=idx + 1,
                        fix_hint="Use If ( condition ; trueValue ; falseValue ) instead",
                    ))
                    break  # One diagnostic per step is enough

        return diags

    def check_hr(self, lines, catalog, context, config):
        from .calculations import NON_CALC_STEPS

        sev = self.severity(config)
        diags = []
        for ln in lines:
            content = ln.bracket_content or ""
            if not content or ln.step_name in NON_CALC_STEPS:
                continue
            if self._has_ternary(content):
                diags.append(Diagnostic(
                    rule_id=self.rule_id,
                    severity=sev,
                    message=(
                        'Calculation contains "?" — FileMaker does not '
                        "support the ternary ? : operator"
                    ),
                    line=ln.line_number,
                    fix_hint="Use If ( condition ; trueValue ; falseValue ) instead",
                ))

        return diags
