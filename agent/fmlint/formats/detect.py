"""Auto-detect whether content is fmxmlsnippet XML, human-readable script, or a standalone calculation."""


def detect_format(content: str) -> str:
    """Return 'xml' or 'hr' based on content heuristics."""
    stripped = content.lstrip()
    if stripped.startswith("<?xml") or stripped.startswith("<fmxmlsnippet"):
        return "xml"
    return "hr"


def detect_format_for_file(filepath: str, content: str) -> str:
    """Return 'xml', 'hr', or 'fmcalc' based on file extension and content."""
    from pathlib import Path
    if Path(filepath).suffix.lower() == ".fmfn":
        return "fmcalc"
    return detect_format(content)
