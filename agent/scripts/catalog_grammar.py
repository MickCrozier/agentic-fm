#!/usr/bin/env python3
"""catalog_grammar.py — shared intermediate representation (IR) and typed catalog
model for the OSS converters (P6.1 scaffold).

This module defines, once for the Python side:

  * ``StepInstance`` — the in-memory shape all four converters read or write, so a
    single grammar engine (P6.2) can serve every direction.
  * ``Value`` — a tagged union of the concrete values a parameter can hold.
  * The typed catalog model (``CatalogEntry`` / ``StepParam`` / ``DiscriminatorBranch``
    and the facet carriers) that the grammar engine reads its rules from.
  * ``param_key()`` — the ParamKey rule (a ``namedCalc`` param keys off its
    ``wrapperElement``, every other param off its ``xmlElement``), matching the
    reference converter. Every ``namedCalc`` shares ``xmlElement == "Calculation"``,
    so the wrapper is what disambiguates them.

No behaviour change ships in P6.1 — this is the type/parse scaffold that P6.2 (Python
grammar engine) and, structurally mirrored, P6.3 (TS) build on. Stdlib only; no venv.

The TS counterpart lives in ``webviewer/src/converter/catalog-types.ts`` and is kept
deliberately parallel so a facet added to one port is obviously missing from the other
(see the plan's "Python↔TS structural parity" risk).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Union

# ---------------------------------------------------------------------------
# Parameter type vocabulary
# ---------------------------------------------------------------------------
# Every ``type`` value observed across the 216-step canonical catalog. The load
# test asserts no param carries a type outside this set (``unknown_typed == 0``);
# a new type appearing here is a deliberate catalog change, not a silent drop.
KNOWN_PARAM_TYPES: frozenset[str] = frozenset(
    {
        "boolean",
        "flagBoolean",
        "flagElement",
        "enum",
        "text",
        "name",
        "calculation",
        "calc",
        "namedCalc",
        "field",
        "fieldOrVariable",
        "fieldList",
        "layout",
        "script",
        "table",
        "tableOccurrence",
        "tableRef",
        "tableReference",
        "reference",
        "fileReference",
        "attrGroup",
        "repeatGroup",
        "bitmaskGroup",
        "findRequests",
        "parametersList",
        "complex",
    }
)


# ---------------------------------------------------------------------------
# Facet carriers — typed views over the advanced grammar the catalog encodes
# ---------------------------------------------------------------------------
@dataclass
class DiscriminatorBranch:
    """One branch of a ``discriminatorValues`` map (keyed by the enum value).

    ``reveal`` lists sibling ParamKeys that become live for this branch; ``hrToken``
    substitutes a fixed HR string for the whole step slot; ``labeled`` flags a branch
    whose revealed params render with their HR labels rather than positionally.
    """

    hr_token: str | None = None
    labeled: bool | None = None
    reveal: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> DiscriminatorBranch:
        return cls(
            hr_token=d.get("hrToken"),
            labeled=d.get("labeled"),
            reveal=list(d.get("reveal", [])),
        )


@dataclass
class VisibleWhen:
    """Gate: this param renders only when ``param`` holds one of ``values``."""

    param: str
    values: list[str]

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> VisibleWhen:
        return cls(param=d["param"], values=list(d.get("values", [])))


@dataclass
class HrLabelRule:
    """One entry of ``hrLabelWhen`` — swap the HR label when a sibling param matches."""

    param: str
    values: list[str]
    hr_label: str | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> HrLabelRule:
        return cls(
            param=d["param"],
            values=list(d.get("values", [])),
            hr_label=d.get("hrLabel"),
        )


@dataclass
class AttrField:
    """A member of an ``attrGroup`` / ``repeatGroup`` ``fields`` list.

    ``kind`` is ``"attr"`` (an XML attribute on the group element) or ``"calc"``
    (a nested ``<Calculation>``). Preserves the full source dict in ``raw``.
    """

    key: str
    kind: str | None = None
    xml_attr: str | None = None
    default_value: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> AttrField:
        return cls(
            key=d.get("key", ""),
            kind=d.get("kind"),
            xml_attr=d.get("xmlAttr"),
            default_value=d.get("defaultValue"),
            raw=dict(d),
        )


# ---------------------------------------------------------------------------
# Catalog schema — the grammar the engine reads from
# ---------------------------------------------------------------------------
@dataclass
class StepParam:
    """A single parameter definition from a catalog step's ``params[]``.

    The plan-named facet fields are typed explicitly; the untyped long tail
    (bitmask sub-keys, ``notes``/``note``, ``entryElement`` and friends) is kept
    verbatim in ``raw`` so nothing is dropped on load and P6.2 can reach it.
    """

    xml_element: str
    type: str
    hr_label: str | None
    required: bool
    xml_attr: str | None = None
    wrapper_element: str | None = None
    parent_element: str | None = None
    default_value: str | None = None
    enum_values: list[str] = field(default_factory=list)
    hr_enum_values: dict[str, str] = field(default_factory=dict)
    inverted_hr: bool | None = None
    enum_style: str | None = None
    flag_style: bool | None = None
    hr_slot: int | None = None
    hr_hidden: bool | None = None
    omit_when_empty: bool | None = None
    emit_empty_default: bool | None = None
    # Governing discriminator: string form names a sibling; map form carries branches.
    discriminator: str | None = None
    discriminator_values: dict[str, DiscriminatorBranch] = field(default_factory=dict)
    visible_when: VisibleWhen | None = None
    hr_label_when: list[HrLabelRule] = field(default_factory=list)
    attr_fields: list[AttrField] = field(default_factory=list)
    description: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> StepParam:
        dv = {
            k: DiscriminatorBranch.from_dict(v)
            for k, v in (d.get("discriminatorValues") or {}).items()
        }
        vw = d.get("visibleWhen")
        return cls(
            xml_element=d.get("xmlElement", ""),
            type=d.get("type", ""),
            hr_label=d.get("hrLabel"),
            required=bool(d.get("required", False)),
            xml_attr=d.get("xmlAttr"),
            wrapper_element=d.get("wrapperElement"),
            parent_element=d.get("parentElement"),
            default_value=d.get("defaultValue"),
            enum_values=list(d.get("enumValues", [])),
            hr_enum_values=dict(d.get("hrEnumValues", {})),
            inverted_hr=d.get("invertedHr"),
            enum_style=d.get("enumStyle"),
            flag_style=d.get("flagStyle"),
            hr_slot=d.get("hrSlot"),
            hr_hidden=d.get("hrHidden"),
            omit_when_empty=d.get("omitWhenEmpty"),
            emit_empty_default=d.get("emitEmptyDefault"),
            discriminator=d.get("discriminator"),
            discriminator_values=dv,
            visible_when=VisibleWhen.from_dict(vw) if vw else None,
            hr_label_when=[HrLabelRule.from_dict(x) for x in d.get("hrLabelWhen", [])],
            attr_fields=[AttrField.from_dict(x) for x in d.get("fields", [])],
            description=d.get("description"),
            raw=dict(d),
        )

    @property
    def is_known_type(self) -> bool:
        return self.type in KNOWN_PARAM_TYPES

    @property
    def key(self) -> str:
        """The ParamKey for this param — see ``param_key``."""
        return param_key(self)


@dataclass
class BlockPair:
    role: str  # "open" | "middle" | "close"
    partners: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> BlockPair:
        return cls(role=d.get("role", ""), partners=list(d.get("partners", [])))


@dataclass
class CatalogEntry:
    name: str
    id: int | None
    category: str
    snippet_file: str
    self_closing: bool
    params: list[StepParam]
    hr_signature: str | None
    block_pair: BlockPair | None
    status: str | None
    help_url: str | None
    notes: Any = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CatalogEntry:
        bp = d.get("blockPair")
        return cls(
            name=d.get("name", ""),
            id=d.get("id"),
            category=d.get("category", ""),
            snippet_file=d.get("snippetFile", ""),
            self_closing=bool(d.get("selfClosing", False)),
            params=[StepParam.from_dict(p) for p in d.get("params", [])],
            hr_signature=d.get("hrSignature"),
            block_pair=BlockPair.from_dict(bp) if bp else None,
            status=d.get("status"),
            help_url=d.get("helpUrl"),
            notes=d.get("notes"),
            raw=dict(d),
        )


def param_key(param: StepParam) -> str:
    """ParamKey rule (matches the reference converter).

    A ``namedCalc`` param keys off its ``wrapperElement`` (every namedCalc shares
    ``xmlElement == "Calculation"``, so the wrapper disambiguates); any other param
    keys off its ``xmlElement``.
    """
    if param.type == "namedCalc" and param.wrapper_element:
        return param.wrapper_element
    return param.xml_element


# ---------------------------------------------------------------------------
# Runtime IR — StepInstance and its Value union
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Absent:
    """The param is not present in the source (distinct from an empty scalar)."""


ABSENT = Absent()


@dataclass(frozen=True)
class Scalar:
    """A raw text / enum / boolean-state value."""

    text: str


@dataclass(frozen=True)
class Calc:
    """A calculation expression (CDATA body)."""

    text: str


@dataclass(frozen=True)
class Field:
    """A field reference."""

    table: str | None = None
    id: int | None = None
    name: str | None = None


@dataclass(frozen=True)
class Ref:
    """A script or layout reference."""

    id: int | None = None
    name: str | None = None


@dataclass
class ListValue:
    """An ordered group (repeat/find requests, parameter lists)."""

    items: list[Value] = field(default_factory=list)


@dataclass
class Group:
    """An attrGroup's attribute bag (attr name → raw string)."""

    attrs: dict[str, str] = field(default_factory=dict)


# Runtime alias (not an annotation): keep ``Union[...]`` rather than ``X | Y`` so it
# evaluates on Python 3.9, the stock macOS python3.
Value = Union[Absent, Scalar, Calc, Field, Ref, ListValue, Group]  # noqa: UP007


@dataclass
class StepInstance:
    """The shared in-memory shape every converter reads or writes.

    ``values`` is keyed by ParamKey (see ``param_key``); a param absent from the
    source is either omitted or mapped to ``ABSENT``.
    """

    name: str
    id: int = 0
    enable: bool = True
    values: dict[str, Value] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Loading + a self-checking load report (the P6.1 acceptance gate)
# ---------------------------------------------------------------------------
def load_catalog(path: str) -> list[CatalogEntry]:
    """Parse the step catalog JSON into typed ``CatalogEntry`` objects."""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    steps = data["steps"] if isinstance(data, dict) and "steps" in data else data
    return [CatalogEntry.from_dict(s) for s in steps]


@dataclass
class LoadReport:
    entries: int
    params_in_json: int
    params_loaded: int
    unknown_typed: list[tuple[str, str, str]]  # (step, xmlElement, type)

    @property
    def dropped(self) -> int:
        return self.params_in_json - self.params_loaded


def load_report(path: str) -> LoadReport:
    """Load the catalog and report whether every param survived typing.

    ``dropped`` counts params present in the JSON but not built into a
    ``StepParam``; ``unknown_typed`` lists params whose ``type`` is outside
    ``KNOWN_PARAM_TYPES``. Both must be zero for P6.1 acceptance.
    """
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    steps = data["steps"] if isinstance(data, dict) and "steps" in data else data
    params_in_json = sum(len(s.get("params", [])) for s in steps)

    entries = [CatalogEntry.from_dict(s) for s in steps]
    params_loaded = sum(len(e.params) for e in entries)
    unknown = [
        (e.name, p.xml_element, p.type)
        for e in entries
        for p in e.params
        if not p.is_known_type
    ]
    return LoadReport(
        entries=len(entries),
        params_in_json=params_in_json,
        params_loaded=params_loaded,
        unknown_typed=unknown,
    )


if __name__ == "__main__":
    import os
    import sys

    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(os.path.dirname(here))
    catalog = os.path.join(repo_root, "agent", "catalogs", "step-catalog-en.json")
    rep = load_report(catalog)
    print(f"entries          : {rep.entries}")
    print(f"params in JSON   : {rep.params_in_json}")
    print(f"params loaded    : {rep.params_loaded}")
    print(f"dropped          : {rep.dropped}")
    print(f"unknown-typed    : {len(rep.unknown_typed)}")
    for step, el, ty in rep.unknown_typed:
        print(f"  ! {step} / {el} : {ty!r}")
    ok = rep.dropped == 0 and not rep.unknown_typed
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)
