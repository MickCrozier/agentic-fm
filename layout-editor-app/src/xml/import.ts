import { parseFMCSS } from './parseFMCSS';
import type { FMStyles } from './parseFMCSS';

export type FMObjectType =
  | 'field' | 'text' | 'button' | 'line' | 'rectangle' | 'portal'
  | 'web-viewer' | 'group' | 'tab-control' | 'slide-control'
  | 'button-bar' | 'popover-btn' | 'popover-panel' | 'container' | 'image' | 'unknown';

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
  /** Named theme style class applied to this object (from LocalCSS name attribute) */
  themeClass?: string;
  /** Local property overrides on top of the theme style (from LocalCSS/FullCSS content) */
  localStyles?: FMStyles;
  children?: LayoutObject[];
  /** Popover panel objects keyed to their button id */
  popoverPanelFor?: string;
  popoverPanelTitle?: string;
  /** Tab control: tab labels (derived from tabPanels for backward compat) */
  tabLabels?: string[];
  /** Tab control: per-panel label + children */
  tabPanels?: { label: string; children: LayoutObject[] }[];
  /** Tab control: strip height in px */
  tabStripHeight?: number;
  /** Slide control: panel count */
  slideCount?: number;
  /** Line objects: actual second endpoint in canvas coords (x=bounds.right, y=bounds.bottom) */
  lineEnd?: { x: number; y: number };
  /** Static image objects: base64 data URL (e.g. data:image/jpeg;base64,...) */
  imageData?: string;
  /** Field control style (edit-box is default/undefined) */
  controlStyle?: 'drop-down-list' | 'drop-down-calendar' | 'pop-up-menu' | 'checkbox-set' | 'radio-button-set';
  /** Button/field icon: inline SVG string (fm_fill class uses currentColor) */
  iconSVG?: string;
  /** Icon display size in pt */
  iconSize?: number;
  /** Icon layout relative to text (undefined = icon-only) */
  iconPosition?: 'left' | 'right' | 'above' | 'below';
  /** Content horizontal alignment from background-position */
  iconAlignH?: 'left' | 'center' | 'right';
  /** Content vertical alignment from background-position */
  iconAlignV?: 'top' | 'middle' | 'bottom';
  /** Static image formatting options */
  imageFormat?: {
    reduce: boolean;
    enlarge: boolean;
    maintainProportions: boolean;
    hAlign: 'left' | 'center' | 'right';
    vAlign: 'top' | 'center' | 'bottom';
  };
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
  'Container':         'container',
  'Text':              'text',
  'Button':            'button',
  'Grouped Button':    'group',
  'Button Bar':        'button-bar',
  'Line':              'line',
  'Rectangle':         'rectangle',
  'Rounded Rectangle': 'rectangle',
  'Graphic':           'image',
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

const FM_CONTROL_STYLE_MAP: Record<string, LayoutObject['controlStyle']> = {
  'Drop-down List':     'drop-down-list',
  'Drop-down Calendar': 'drop-down-calendar',
  'Pop-up Menu':        'pop-up-menu',
  'Checkbox Set':       'checkbox-set',
  'Radio Button Set':   'radio-button-set',
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
  const rawWidth  = bounds.right  - bounds.left;
  const rawHeight = bounds.bottom - bounds.top;
  const isLine = type === 'line';
  if (!isLine && (rawWidth <= 0 || rawHeight <= 0)) return null;
  if (isLine && rawWidth <= 0 && rawHeight <= 0) return null;
  // Lines can have a zero dimension (horizontal or vertical) — clamp to 1 for DOM rendering
  const width  = rawWidth  > 0 ? rawWidth  : 1;
  const height = rawHeight > 0 ? rawHeight : 1;

  // A "Grouped Button" containing a PopoverButton element is a popover button
  const effectiveType: FMObjectType = (type === 'group' && objEl.querySelector('GroupedButton > PopoverButton'))
    ? 'popover-btn'
    : type;

  const id = makeObjId(fmName, fmId, effectiveType, uniqueId);

  const base: LayoutObject = {
    id, fmId, fmName, type: effectiveType, bounds,
    x: absLeft, y: absTop, width, height,
    ...(isLine ? { lineEnd: { x: absLeft + rawWidth, y: absTop + rawHeight } } : {}),
  };

  const tooltip      = calcText(objEl.querySelector('Tooltip > Calculation > Text')) || undefined;
  const localCSS     = objEl.querySelector('LocalCSS');
  const fullCSS      = objEl.querySelector('FullCSS');
  const localCSSName = localCSS?.getAttribute('name')?.trim() ?? '';
  // Prefer LocalCSS name (UUID or named style) over FM type base class
  const themeClass   = localCSSName || fmTypeToThemeClass(fmType);
  // Shapes store styles in FullCSS (.main block); other objects use LocalCSS (.self block)
  const localStyles     = parseFMCSS(localCSS?.textContent ?? fullCSS?.textContent ?? '');

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
    return { ...base, tooltip, localStyles, themeClass, children };
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
              if (child) panelChildren.push(child);
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
    return { ...base, tooltip, localStyles, themeClass, displayText: label };
  }

  // ── Tab Control ───────────────────────────────────────────────────────────
  if (effectiveType === 'tab-control') {
    const tabCtrlEl = objEl.querySelector('TabControl');
    const tabStripHeight = tabCtrlEl ? intAttr(tabCtrlEl, 'height', 24) : 24;
    const tabPanels: { label: string; children: LayoutObject[] }[] = [];
    const tabObjList = tabCtrlEl?.querySelector('ObjectList');
    if (tabObjList) {
      for (const panelEl of childElements(tabObjList, 'LayoutObject').filter(
        c => c.getAttribute('type') === 'Panel',
      )) {
        const label = calcText(panelEl.querySelector('TabPanel > Calculation > Text'));
        const panelChildren: LayoutObject[] = [];
        const tabPanelObjList = panelEl.querySelector('TabPanel > ObjectList');
        if (tabPanelObjList) {
          for (const childEl of childElements(tabPanelObjList, 'LayoutObject')) {
            const child = parseObject(childEl, 0, 0, uniqueId, popoverPanels);
            if (child) panelChildren.push(child);
          }
        }
        tabPanels.push({ label, children: panelChildren });
      }
    }
    const tabLabels = tabPanels.map(p => p.label);
    return { ...base, tooltip, localStyles, themeClass, tabLabels, tabPanels, tabStripHeight };
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
    return { ...base, tooltip, localStyles, themeClass, slideCount, children };
  }

  // ── Button Bar ────────────────────────────────────────────────────────────
  if (effectiveType === 'button-bar') {
    const bbEl = objEl.querySelector('ButtonBar');
    const segments: LayoutObject[] = [];
    const segList = bbEl?.querySelector('ObjectList');
    if (segList) {
      for (const segEl of childElements(segList, 'LayoutObject')) {
        const seg = parseObject(segEl, 0, 0, uniqueId, popoverPanels);
        if (seg) segments.push(seg);
      }
    }
    return { ...base, tooltip, localStyles, themeClass, children: segments };
  }

  // ── Static image (Graphic) ────────────────────────────────────────────────
  if (effectiveType === 'image') {
    const streams = objEl.querySelectorAll('BinaryData > StreamList > Stream');
    let imageData: string | undefined;
    let mainFormat = 'JPEG';
    for (const s of streams) {
      if (s.getAttribute('name') === 'MAIN' && s.getAttribute('type') === 'id') {
        mainFormat = s.textContent?.trim() ?? 'JPEG';
      }
    }
    for (const s of streams) {
      if (s.getAttribute('name') === mainFormat && s.getAttribute('type') === 'Base64') {
        const mimeMap: Record<string, string> = { JPEG: 'image/jpeg', PNG_: 'image/png', GIFf: 'image/gif', TIFF: 'image/tiff' };
        const mime = mimeMap[mainFormat] ?? 'image/jpeg';
        imageData = `data:${mime};base64,${(s.textContent ?? '').trim()}`;
        break;
      }
    }
    const fmtEl = objEl.querySelector('Graphic > Formatting > Options');
    const fmtOpts = fmtEl ? parseInt(fmtEl.textContent ?? '0', 10) : 0;
    const hAlignMap: ('left' | 'center' | 'right')[] = ['left', 'center', 'right'];
    const vAlignMap: ('top' | 'center' | 'bottom')[] = ['top', 'center', 'bottom'];
    const imageFormat = {
      reduce:             !!(fmtOpts & 1),
      enlarge:            !!(fmtOpts & 2),
      maintainProportions:!!(fmtOpts & 4),
      hAlign: hAlignMap[Math.min((fmtOpts >> 3) & 3, 2)],
      vAlign: vAlignMap[Math.min((fmtOpts >> 5) & 3, 2)],
    };
    return { ...base, tooltip, localStyles, themeClass, imageData, imageFormat };
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
    // Button label text (most specific path first)
    const btnLabelEl = objEl.querySelector('Button > Label > Text > StyledText > Data');
    if (btnLabelEl) displayText = btnLabelEl.textContent?.trim();
  }
  if (!displayText) {
    const dataEl = objEl.querySelector('Text > StyledText > Data');
    if (dataEl) displayText = dataEl.textContent?.trim();
  }
  if (!displayText) {
    displayText = calcText(objEl.querySelector('Button > Label > Calculation > Text'));
  }

  // Parse SVG icon if present
  let iconSVG: string | undefined;
  let iconSize: number | undefined;
  let iconPosition: LayoutObject['iconPosition'];
  let iconAlignH: LayoutObject['iconAlignH'] = 'center';
  let iconAlignV: LayoutObject['iconAlignV'] = 'middle';
  const iconDataEl = objEl.querySelector(':scope > Button > IconData, :scope > IconData');
  const iconType = iconDataEl?.getAttribute('type');
  if (iconDataEl && iconType !== '0' && iconType !== null) {
    iconSize = parseInt(iconDataEl.getAttribute('size') ?? '16', 10);
    const svgStream = iconDataEl.querySelector('Stream[name="SVG "]');
    if (svgStream?.textContent) {
      try {
        const raw = atob(svgStream.textContent.trim());
        iconSVG = raw.replace('<svg ', '<svg style="display:block;width:100%;height:100%" ')
          .replace('</svg>', '<style>.fm_fill{fill:currentColor}.fm_stroke{stroke:currentColor}</style></svg>');
      } catch {}
    }

    // icon type → layout
    // 1 = icon only, 2 = icon above/text below, 3 = icon below/text above, 4 = icon left, 5 = icon right
    if      (iconType === '2') iconPosition = 'above';
    else if (iconType === '3') iconPosition = 'below';
    else if (iconType === '4') iconPosition = 'left';
    else if (iconType === '5') iconPosition = 'right';
    // type 1 = icon only → iconPosition stays undefined

    // background-position [h] [v] in the .icon block encodes content alignment (V1-style themes)
    const lcssText = objEl.querySelector('LocalCSS')?.textContent ?? '';
    const bgPosMatch = lcssText.match(/background-position\s*:\s*(left|center|right)\s+(top|center|bottom)/);
    if (bgPosMatch) {
      const [, h, v] = bgPosMatch;
      iconAlignH = h as 'left' | 'center' | 'right';
      iconAlignV = v === 'top' ? 'top' : v === 'bottom' ? 'bottom' : 'middle';
    } else {
      // Fall back to text-align / -fm-text-vertical-align from .self block (V2-style themes)
      if (localStyles.textAlign === 'left' || localStyles.textAlign === 'right') {
        iconAlignH = localStyles.textAlign;
      } else if (localStyles.textAlign === 'center') {
        iconAlignH = 'center';
      }
      if (localStyles.verticalAlign) {
        iconAlignV = localStyles.verticalAlign === 'top' ? 'top'
          : localStyles.verticalAlign === 'bottom' ? 'bottom'
          : 'middle';
      }
    }
  }

  const controlStyle = FM_CONTROL_STYLE_MAP[fmType];

  return { ...base, displayText, fieldRef, tooltip, localStyles, themeClass,
    ...(controlStyle ? { controlStyle } : {}),
    ...(iconSVG ? { iconSVG, iconSize, iconPosition, iconAlignH, iconAlignV } : {}) };
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
