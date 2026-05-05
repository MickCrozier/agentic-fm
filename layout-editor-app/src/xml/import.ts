import { parseFMCSS } from './parseFMCSS';
import type { FMStyles } from './parseFMCSS';

export type FMObjectType =
  | 'field' | 'text' | 'button' | 'line' | 'rectangle' | 'portal'
  | 'web-viewer' | 'group' | 'tab-control' | 'slide-control'
  | 'popover-btn' | 'popover-panel' | 'unknown';

export interface Bounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface LayoutObject {
  id: string;
  fmId: string;
  fmName: string;
  type: FMObjectType;
  bounds: Bounds;
  /** Absolute canvas coords (same as bounds for top-level; adjusted for group children) */
  x: number;
  y: number;
  width: number;
  height: number;
  displayText?: string;
  fieldRef?: string;
  tooltip?: string;
  hideCondition?: string;
  fmStyles?: FMStyles;
  themeClass?: string;
  children?: LayoutObject[];
  /** Popover panel objects keyed to their button id */
  popoverPanelFor?: string;
  popoverPanelTitle?: string;
  /** Tab control: tab labels */
  tabLabels?: string[];
  /** Slide control: panel count */
  slideCount?: number;
}

export interface LayoutPart {
  type: string;
  bottom: number;
}

export interface LayoutState {
  width: number;
  parts: LayoutPart[];
  objects: LayoutObject[];
  /** Popover panels collected during parse (appended at canvas root, not nested) */
  popoverPanels: LayoutObject[];
}

// ── FM type → editor type ───────────────────────────────────────────────────

const FM_TYPE_MAP: Record<string, FMObjectType> = {
  'Field':             'field',
  'Edit Box':          'field',
  'Drop-down List':    'field',
  'Drop-down Calendar':'field',
  'Pop-up Menu':       'field',
  'Checkbox Set':      'field',
  'Radio Button Set':  'field',
  'Container':         'field',
  'Text':              'text',
  'Button':            'button',
  'Grouped Button':    'group',
  'Button Bar':        'button',
  'Line':              'line',
  'Rectangle':         'rectangle',
  'Rounded Rectangle': 'rectangle',
  'Graphic':           'rectangle',
  'Portal':            'portal',
  'Web Viewer':        'web-viewer',
  'Group':             'group',
  'Tab Control':       'tab-control',
  'Slide Control':     'slide-control',
  'Popover Button':    'popover-btn',
};

function fmTypeToEditorType(fmType: string): FMObjectType {
  return FM_TYPE_MAP[fmType] ?? 'unknown';
}

// Maps FM object type strings to MidTown/Apex Blue base theme CSS class names
const FM_THEME_CLASS_MAP: Record<string, string> = {
  'Edit Box':           'edit_box',
  'Field':              'edit_box',
  'Drop-down List':     'drop_down',
  'Drop-down Calendar': 'calendar',
  'Pop-up Menu':        'pop_up',
  'Checkbox Set':       'checkbox_set',
  'Radio Button Set':   'radio_set',
  'Container':          'container',
  'Text':               'text_box',
  'Button':             'button',
  'Button Bar':         'button_bar_segment',
  'Line':               'line',
  'Rectangle':          'rectangle',
  'Rounded Rectangle':  'rounded',
  'Graphic':            'rectangle',
  'Web Viewer':         'web_viewer',
};

function fmTypeToThemeClass(fmType: string): string | undefined {
  return FM_THEME_CLASS_MAP[fmType];
}

// ── ID generation ────────────────────────────────────────────────────────────

function makeIdGenerator() {
  const used = new Set<string>();
  return function uniqueId(base: string): string {
    let id = base, n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
  };
}

function makeObjId(
  fmName: string,
  fmId: string,
  type: FMObjectType,
  uniqueId: (base: string) => string,
): string {
  if (fmName) {
    const slug = fmName.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return uniqueId(slug || 'obj');
  }
  const prefix = type === 'unknown' ? 'obj' : type;
  return uniqueId(`${prefix}-${fmId}`);
}

// ── XML helpers ──────────────────────────────────────────────────────────────

function attr(el: Element, name: string, fallback = ''): string {
  return el.getAttribute(name) ?? fallback;
}

function intAttr(el: Element, name: string, fallback = 0): number {
  const v = el.getAttribute(name);
  if (v === null) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function calcText(el: Element | null): string {
  if (!el) return '';
  return el.textContent?.trim().replace(/^"|"$/g, '') ?? '';
}

function parseBounds(boundsEl: Element): Bounds {
  return {
    top:    intAttr(boundsEl, 'top'),
    left:   intAttr(boundsEl, 'left'),
    bottom: intAttr(boundsEl, 'bottom'),
    right:  intAttr(boundsEl, 'right'),
  };
}

function childElements(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter(c => c.tagName === tag);
}

// ── Recursive object parser ──────────────────────────────────────────────────

function parseObject(
  objEl: Element,
  offsetX: number,
  offsetY: number,
  uniqueId: (base: string) => string,
  popoverPanels: LayoutObject[],
): LayoutObject | null {
  const fmType = attr(objEl, 'type');
  const fmName = attr(objEl, 'name').trim();
  const fmId   = attr(objEl, 'id', '0');
  const type   = fmTypeToEditorType(fmType);

  const boundsEl = objEl.querySelector('Bounds');
  if (!boundsEl) return null;

  const bounds = parseBounds(boundsEl);
  const absLeft = bounds.left + offsetX;
  const absTop  = bounds.top  + offsetY;
  const width   = bounds.right  - bounds.left;
  const height  = bounds.bottom - bounds.top;
  if (width <= 0 || height <= 0) return null;

  // A "Grouped Button" containing a PopoverButton element is a popover button
  const effectiveType: FMObjectType = (type === 'group' && objEl.querySelector('GroupedButton > PopoverButton'))
    ? 'popover-btn'
    : type;

  const id = makeObjId(fmName, fmId, effectiveType, uniqueId);

  const base: LayoutObject = {
    id, fmId, fmName, type: effectiveType, bounds,
    x: absLeft, y: absTop, width, height,
  };

  const tooltip      = calcText(objEl.querySelector('Tooltip > Calculation > Text')) || undefined;
  const localCSS     = objEl.querySelector('LocalCSS');
  const localCSSName = localCSS?.getAttribute('name')?.trim() ?? '';
  // Prefer LocalCSS name (UUID or named style) over FM type base class
  const themeClass   = localCSSName || fmTypeToThemeClass(fmType);
  const fmStyles     = parseFMCSS(localCSS?.textContent ?? '');

  // ── Group ─────────────────────────────────────────────────────────────────
  if (effectiveType === 'group') {
    const childListEl = objEl.querySelector('GroupedButton > ObjectList') ?? objEl.querySelector('ObjectList');
    const children: LayoutObject[] = [];
    if (childListEl) {
      for (const childEl of childElements(childListEl, 'LayoutObject')) {
        const child = parseObject(childEl, 0, 0, uniqueId, popoverPanels);
        if (child) children.push(child);
      }
    }
    return { ...base, tooltip, fmStyles, themeClass, children };
  }

  // ── Popover Button ────────────────────────────────────────────────────────
  if (effectiveType === 'popover-btn') {
    const label = calcText(objEl.querySelector('PopoverButton > Label > Calculation > Text'))
      || calcText(objEl.querySelector('GroupedButton > PopoverButton > Label > Calculation > Text'));
    const popBtnEl = objEl.querySelector('PopoverButton') ?? objEl.querySelector('GroupedButton > PopoverButton');
    // Panel is a <LayoutObject type="PopoverPanel"> child of <PopoverButton>
    const panelObjEl = popBtnEl
      ? (Array.from(popBtnEl.children).find(c => c.tagName === 'LayoutObject' && c.getAttribute('type') === 'PopoverPanel') ?? null)
      : null;

    if (panelObjEl) {
      const pb = panelObjEl.querySelector('Bounds');
      if (pb) {
        const pbounds = parseBounds(pb);
        const pw = pbounds.right - pbounds.left;
        const ph = pbounds.bottom - pbounds.top;
        if (pw > 0 && ph > 0) {
          const title   = calcText(panelObjEl.querySelector('Title > Text'));
          const panelId = uniqueId(`popover-panel-${fmId}`);
          const panelChildren: LayoutObject[] = [];
          const panelObjList = panelObjEl.querySelector('ObjectList');
          if (panelObjList) {
            for (const childEl of childElements(panelObjList, 'LayoutObject')) {
              const child = parseObject(childEl, 0, 0, uniqueId, popoverPanels);
              if (child) {
                const relChild = { ...child, x: child.x - pbounds.left, y: child.y - pbounds.top };
                panelChildren.push(relChild);
              }
            }
          }
          popoverPanels.push({
            id: panelId,
            fmId: attr(panelObjEl, 'id', '0'),
            fmName: '',
            type: 'popover-panel',
            bounds: pbounds,
            x: pbounds.left, y: pbounds.top, width: pw, height: ph,
            popoverPanelFor: id,
            popoverPanelTitle: title || 'Popover',
            children: panelChildren,
          });
        }
      }
    }
    return { ...base, tooltip, fmStyles, themeClass, displayText: label };
  }

  // ── Tab Control ───────────────────────────────────────────────────────────
  if (effectiveType === 'tab-control') {
    const tabCtrlEl = objEl.querySelector('TabControl');
    const tabLabels: string[] = [];
    const children: LayoutObject[] = [];
    const tabObjList = tabCtrlEl?.querySelector('ObjectList');
    if (tabObjList) {
      for (const panelEl of childElements(tabObjList, 'LayoutObject').filter(
        c => c.getAttribute('type') === 'Panel',
      )) {
        tabLabels.push(calcText(panelEl.querySelector('TabPanel > Calculation > Text')));
        const tabPanelObjList = panelEl.querySelector('TabPanel > ObjectList');
        if (tabPanelObjList) {
          for (const childEl of childElements(tabPanelObjList, 'LayoutObject')) {
            const child = parseObject(childEl, 0, 0, uniqueId, popoverPanels);
            if (child) children.push(child);
          }
        }
      }
    }
    return { ...base, tooltip, fmStyles, themeClass, tabLabels, children };
  }

  // ── Slide Control ─────────────────────────────────────────────────────────
  if (effectiveType === 'slide-control') {
    const slideCtrlEl = objEl.querySelector('SlideControl');
    const children: LayoutObject[] = [];
    let slideCount = 0;
    const slideObjList = slideCtrlEl?.querySelector('ObjectList');
    if (slideObjList) {
      for (const panelEl of childElements(slideObjList, 'LayoutObject').filter(
        c => c.getAttribute('type') === 'Panel',
      )) {
        slideCount++;
        const slidePanelObjList = panelEl.querySelector('SlidePanel > ObjectList');
        if (slidePanelObjList) {
          for (const childEl of childElements(slidePanelObjList, 'LayoutObject')) {
            const child = parseObject(childEl, 0, 0, uniqueId, popoverPanels);
            if (child) children.push(child);
          }
        }
      }
    }
    return { ...base, tooltip, fmStyles, themeClass, slideCount, children };
  }

  // ── Regular object ────────────────────────────────────────────────────────
  let fieldRef: string | undefined;
  const fieldEl = objEl.querySelector('Field > FieldReference');
  if (fieldEl) {
    const toEl   = fieldEl.querySelector('TableOccurrenceReference');
    const toName = toEl ? attr(toEl, 'name') : '';
    const fname  = attr(fieldEl, 'name');
    if (toName && fname) fieldRef = `${toName}::${fname}`;
  }

  let displayText = fieldRef;
  if (!displayText) {
    const dataEl = objEl.querySelector('Text > StyledText > Data');
    if (dataEl) displayText = dataEl.textContent?.trim();
  }
  if (!displayText) {
    displayText = calcText(objEl.querySelector('Button > Label > Calculation > Text'));
  }

  return { ...base, displayText, fieldRef, tooltip, fmStyles, themeClass };
}

// ── Main entry ───────────────────────────────────────────────────────────────

export function loadLayoutXML(xmlText: string): LayoutState | null {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xmlText, 'application/xml');

  const parseErr = doc.querySelector('parsererror');
  if (parseErr) return null;

  const layoutEl = doc.querySelector('Layout');
  if (!layoutEl) return null;

  const width = intAttr(layoutEl, 'width', 760);

  // Parts
  const parts: LayoutPart[] = [];
  layoutEl.querySelectorAll('PartsList > Part').forEach(partEl => {
    const def = partEl.querySelector('Definition');
    if (!def) return;
    const type   = attr(def, 'type') || attr(partEl, 'type') || 'Part';
    const absTop = intAttr(def, 'absolute');
    const size   = intAttr(def, 'size');
    parts.push({ type, bottom: absTop + size });
  });

  // Objects
  const uniqueId   = makeIdGenerator();
  const objects: LayoutObject[]      = [];
  const popoverPanels: LayoutObject[] = [];

  layoutEl.querySelectorAll('PartsList > Part').forEach(partEl => {
    const ol = partEl.querySelector('ObjectList');
    if (!ol) return;
    for (const objEl of childElements(ol, 'LayoutObject')) {
      const obj = parseObject(objEl, 0, 0, uniqueId, popoverPanels);
      if (obj) objects.push(obj);
    }
  });

  return { width, parts, objects, popoverPanels };
}
