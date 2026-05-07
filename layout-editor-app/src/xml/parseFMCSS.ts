/**
 * Parses FileMaker LocalCSS CDATA into a CSS properties object suitable for
 * React/Preact inline styles. Handles FM-specific syntax conversions.
 */

export interface FMStyles {
  backgroundColor?: string;
  color?: string;
  borderTopColor?: string;
  borderRightColor?: string;
  borderBottomColor?: string;
  borderLeftColor?: string;
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderTopStyle?: string;
  borderRightStyle?: string;
  borderBottomStyle?: string;
  borderLeftStyle?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  textAlign?: string;
  verticalAlign?: 'top' | 'center' | 'bottom';
  boxShadow?: string;
}

/** Convert FM percentage rgba to standard rgb/rgba string */
function convertColor(value: string): string {
  // rgba(100%,100%,100%,1) → rgba(255,255,255,1)
  const pct = value.match(/rgba?\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (pct) {
    const r = Math.round(parseFloat(pct[1]) * 2.55);
    const g = Math.round(parseFloat(pct[2]) * 2.55);
    const b = Math.round(parseFloat(pct[3]) * 2.55);
    const a = pct[4] !== undefined ? parseFloat(pct[4]) : 1;
    return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
  }
  return value;
}

/** Convert pt to px — FM renders at 72dpi so 1pt = 1px on screen */
function ptToPx(value: string): string {
  return value.replace(/([\d.]+)pt/g, (_, n) => `${Math.round(parseFloat(n))}px`);
}

/** Extract font name from -fm-font-family(Display,PostScript) */
function convertFontFamily(value: string): string {
  const m = value.match(/-fm-font-family\(([^,)]+)/);
  if (m) return m[1].trim();
  return value;
}

/** Map FM border styles to standard CSS */
function convertBorderStyle(value: string): string {
  if (value === 'outset' || value === 'inset') return 'solid';
  return value;
}

export function parseFMCSS(cssText: string): FMStyles {
  if (!cssText) return {};

  // Extract the .self { ... } block (skip .inner_border and other blocks)
  const selfMatch = cssText.match(/self:normal\s+\.self\s*\{([^}]*)\}/);
  if (!selfMatch) return {};

  const block = selfMatch[1];
  const props: Record<string, string> = {};

  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*;?\s*$/);
    if (!m) continue;
    const [, prop, val] = m;
    if (!val || val.trim() === '') continue;
    props[prop] = val.trim();
  }

  const styles: FMStyles = {};

  // Skip background-color when FM fill effect is active — the actual fill is a theme image/gradient
  const hasFillEffect = props['-fm-fill-effect'] && props['-fm-fill-effect'] !== '0';
  if (props['background-color'] && !hasFillEffect) styles.backgroundColor = convertColor(props['background-color']);
  if (props['color'])            styles.color           = convertColor(props['color']);

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const capSide = (side.charAt(0).toUpperCase() + side.slice(1)) as 'Top' | 'Right' | 'Bottom' | 'Left';

    const colorVal = props[`border-${side}-color`];
    const widthVal = props[`border-${side}-width`];
    const styleVal = props[`border-${side}-style`];

    if (colorVal) (styles as Record<string, string>)[`border${capSide}Color`] = convertColor(colorVal);
    if (widthVal) (styles as Record<string, string>)[`border${capSide}Width`] = ptToPx(widthVal);
    if (styleVal) (styles as Record<string, string>)[`border${capSide}Style`] = convertBorderStyle(styleVal);
  }

  if (props['font-family']) styles.fontFamily = convertFontFamily(props['font-family']);
  if (props['font-size'])   styles.fontSize   = ptToPx(props['font-size']);
  if (props['font-weight']) styles.fontWeight  = props['font-weight'];
  if (props['text-align'])  styles.textAlign   = props['text-align'];
  if (props['box-shadow'])  styles.boxShadow   = props['box-shadow'];

  const va = props['-fm-text-vertical-align'];
  if (va === 'top' || va === 'center' || va === 'bottom') styles.verticalAlign = va;

  return styles;
}
