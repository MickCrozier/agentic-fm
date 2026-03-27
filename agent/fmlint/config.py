"""FMLint configuration — loads rule settings from config files."""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .types import Severity


# ---------------------------------------------------------------------------
# Config file discovery
# ---------------------------------------------------------------------------

def _find_config_files(project_root: Optional[Path] = None) -> list:
    """Return config file paths in priority order (defaults first, overrides last)."""
    files = []

    # 1. Built-in defaults (shipped with fmlint)
    builtin = Path(__file__).parent / "fmlint.config.json"
    if builtin.exists():
        files.append(builtin)

    # 2. Project-level overrides (gitignored, per-solution)
    if project_root:
        project_cfg = project_root / "agent" / "config" / "fmlint.config.json"
        if project_cfg.exists():
            files.append(project_cfg)

    return files


def _load_json(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base. Override wins for leaf values."""
    merged = dict(base)
    for key, val in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(val, dict):
            merged[key] = _deep_merge(merged[key], val)
        else:
            merged[key] = val
    return merged


# ---------------------------------------------------------------------------
# LintConfig
# ---------------------------------------------------------------------------

_SEVERITY_MAP = {
    "error": Severity.ERROR,
    "warning": Severity.WARNING,
    "info": Severity.INFO,
    "hint": Severity.HINT,
}


@dataclass
class LintConfig:
    """Configuration for a lint run.

    The `rule_configs` dict maps rule_id -> dict of rule-specific settings.
    Each entry has at minimum 'enabled' and 'severity', plus rule-specific keys.
    """
    rule_configs: dict = field(default_factory=dict)  # rule_id -> {...}
    disabled_rules: set = field(default_factory=set)   # CLI-level overrides
    max_tier: Optional[int] = None

    def is_enabled(self, rule_id: str) -> bool:
        """Check if a rule is enabled (CLI override takes precedence)."""
        if rule_id in self.disabled_rules:
            return False
        rc = self.rule_configs.get(rule_id, {})
        return rc.get("enabled", True)

    def get_severity(self, rule_id: str, default: Severity = Severity.WARNING) -> Severity:
        """Get the configured severity for a rule."""
        rc = self.rule_configs.get(rule_id, {})
        sev_str = rc.get("severity", "")
        return _SEVERITY_MAP.get(sev_str, default)

    def get_rule_config(self, rule_id: str) -> dict:
        """Get the full config dict for a specific rule."""
        return self.rule_configs.get(rule_id, {})

    @classmethod
    def load(cls, project_root: Optional[Path] = None, extra_config: Optional[Path] = None) -> "LintConfig":
        """Load config from default + project + optional extra config files."""
        cfg = cls()

        # Load and merge config files
        merged_rules = {}
        for config_path in _find_config_files(project_root):
            data = _load_json(config_path)
            rules = data.get("rules", {})
            merged_rules = _deep_merge(merged_rules, rules)

        # Extra config (e.g. from --config CLI flag)
        if extra_config and extra_config.exists():
            data = _load_json(extra_config)
            rules = data.get("rules", {})
            merged_rules = _deep_merge(merged_rules, rules)

        cfg.rule_configs = merged_rules
        return cfg

    @classmethod
    def from_dict(cls, data: dict) -> "LintConfig":
        """Create config from a dict (for programmatic use / backward compat)."""
        cfg = cls()
        if "disable" in data:
            cfg.disabled_rules = set(data["disable"])
        if "max_tier" in data:
            cfg.max_tier = data["max_tier"]
        # If a full rules block is provided, use it
        if "rules" in data:
            cfg.rule_configs = data["rules"]
        return cfg
