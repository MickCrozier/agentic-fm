/** Convert raw FM theme CSS to browser-compatible CSS */

function convertFMColor(value: string): string {
  return value.replace(
    /rgba?\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)/g,
    (_, r, g, b, a) => {
      const ri = Math.round(parseFloat(r) * 2.55);
      const gi = Math.round(parseFloat(g) * 2.55);
      const bi = Math.round(parseFloat(b) * 2.55);
      const alpha = a !== undefined ? parseFloat(a) : 1;
      return alpha < 1 ? `rgba(${ri},${gi},${bi},${alpha})` : `rgb(${ri},${gi},${bi})`;
    }
  );
}

function convertPt(value: string): string {
  return value.replace(/([\d.]+)pt/g, (_, n) => `${Math.round(parseFloat(n))}px`);
}

function convertWebkitGradient(value: string): string {
  return value.replace(/-webkit-gradient\([^;]+\)/g, (match) => {
    // Match: linear, startX% startY%, endX% endY% — capture the end point Y
    const endPt = match.match(/linear\s*,\s*[\d.]+%\s+[\d.]+%\s*,\s*[\d.]+%\s+([\d.]+)%/);
    const endY = endPt ? parseFloat(endPt[1]) : 100;
    const dir = endY > 50 ? 'to bottom' : 'to right';

    const stops: string[] = [];
    const fromM = match.match(/\bfrom\((rgba?\([^)]+\)|[^)]+)\)/);
    if (fromM) stops.push(fromM[1]);
    const csRe = /\bcolor-stop\([\d.]+\s*,\s*(rgba?\([^)]+\)|[^)]+)\)/g;
    let csM;
    while ((csM = csRe.exec(match)) !== null) stops.push(csM[1]);
    const toM = match.match(/\bto\((rgba?\([^)]+\)|[^)]+)\)/);
    if (toM) stops.push(toM[1]);

    if (stops.length < 2) return match;
    return `linear-gradient(${dir}, ${stops[0]}, ${stops[stops.length - 1]})`;
  });
}

/**
 * Convert FM theme CSS to browser-compatible CSS.
 *
 * Selector forms handled:
 *   classname:normal .sub        → .fm-theme-classname .sub
 *   type.FM-UUID:normal .sub     → .fm-theme-FM-UUID .sub
 *
 * All non-:normal state blocks are dropped.
 * Orphan blocks (no preceding selector, appear after FM state blocks) are also dropped.
 */
const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;

function completeBorderStyles(blockLines: string[]): string[] {
  // FM theme CSS sets border-color for all sides but may only set border-X-style for some sides.
  // Any side with no explicit style defaults to none in FM — inject it so the browser doesn't
  // inherit a 'solid' style from a base rule and show an unintended colored border.
  const setSides = new Set<string>();
  for (const l of blockLines) {
    const m = l.match(/border-(top|right|bottom|left)-style\s*:/);
    if (m) setSides.add(m[1]);
  }
  if (setSides.size === 0 || setSides.size === 4) return blockLines;

  const injected: string[] = [];
  for (const side of BORDER_SIDES) {
    if (!setSides.has(side)) injected.push(`    border-${side}-style: none;`);
  }
  return [...blockLines, ...injected];
}

export function convertThemeCSS(raw: string): string {
  let converted = convertFMColor(raw);
  converted = convertPt(converted);
  converted = convertWebkitGradient(converted);

  const lines = converted.split('\n');
  const out: string[] = [];
  let skip = true;
  let depth = 0;
  let blockLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Matches: baseType.NamedClass:state .sub  OR  baseType.FM-UUID:state .sub  OR  baseType:state .sub
    const fmSelector = trimmed.match(/^[\w-]+(?:\.([\w-]+))?:([\w]+)\s+(\.[\w-]+)\s*$/);
    if (fmSelector) {
      const [, namedClass, state, subClass] = fmSelector;
      // Use the named subclass as the theme key if present, otherwise the full base type
      const baseType = trimmed.split(':')[0].split('.')[0];
      const themeKey = namedClass
        ? (namedClass.startsWith('FM-') ? namedClass : namedClass)
        : baseType;
      if (state === 'normal') {
        if (subClass === '.self') {
          out.push(`.fm-theme-${themeKey} .self, .fm-theme-${themeKey}.self`);
        } else {
          out.push(`.fm-theme-${themeKey} ${subClass}`);
        }
        skip = false;
      } else {
        if (subClass === '.self') {
          out.push(`.fm-state-${state}.fm-theme-${themeKey} .self, .fm-state-${state} .fm-theme-${themeKey} .self`);
        } else {
          out.push(`.fm-state-${state}.fm-theme-${themeKey} ${subClass}, .fm-state-${state} .fm-theme-${themeKey} ${subClass}`);
        }
        skip = false;
      }
      depth = 0;
      blockLines = [];
      continue;
    }

    if (trimmed === '{') {
      depth++;
      if (!skip) out.push(line);
      continue;
    }
    if (trimmed === '}') {
      if (!skip) {
        for (const bl of completeBorderStyles(blockLines)) out.push(bl);
        blockLines = [];
        out.push(line);
      }
      depth--;
      if (depth <= 0) {
        depth = 0;
        skip = true;
      }
      continue;
    }

    if (skip) continue;
    if (/^\s*-fm-/.test(line)) continue;
    if (/line-height\s*:.*\bline\b/.test(line)) continue;
    // Mirror text-align as justify-content so flex icon+text groups align correctly
    const taMatch = line.match(/^(\s*)text-align\s*:\s*(left|center|right)\s*;/);
    if (taMatch) {
      const jc = taMatch[2] === 'center' ? 'center' : taMatch[2] === 'right' ? 'flex-end' : 'flex-start';
      const injectedJC = `${taMatch[1]}justify-content: ${jc};`;
      blockLines.push(injectedJC);
      out.push(injectedJC);
    }
    if (/font-family\s*:.*-fm-font-family/.test(line)) {
      const m = line.match(/-fm-font-family\(([^,)]+)/);
      if (m) {
        const emitted = line.replace(/-fm-font-family\([^)]+\)/, `"${m[1].trim()}"`);
        blockLines.push(emitted);
        out.push(emitted);
      }
      continue;
    }
    if (/background-image\s*:\s*none/.test(line)) continue;
    if (/border-image/.test(line)) continue;

    blockLines.push(line);
    out.push(line);
  }

  return out.join('\n');
}
