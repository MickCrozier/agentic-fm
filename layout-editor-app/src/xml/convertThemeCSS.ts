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
export function convertThemeCSS(raw: string): string {
  let converted = convertFMColor(raw);
  converted = convertPt(converted);
  converted = convertWebkitGradient(converted);

  const lines = converted.split('\n');
  const out: string[] = [];
  // skip=true by default — only a :normal selector can open a block
  let skip = true;
  let depth = 0;
  // Whether the current top-level block was opened by a :normal selector
  let inNormalBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    const fmSelector = trimmed.match(/^([\w-]+(?:\.FM-[\w-]+)?):([\w]+)\s+(\.[\w-]+)\s*$/);
    if (fmSelector) {
      const [, rawClass, state, subClass] = fmSelector;
      if (state === 'normal') {
        const themeKey = rawClass.includes('.FM-')
          ? 'FM-' + rawClass.split('.FM-')[1]
          : rawClass;
        if (subClass === '.self') {
          out.push(`.fm-theme-${themeKey} .self, .fm-theme-${themeKey}.self`);
        } else {
          out.push(`.fm-theme-${themeKey} ${subClass}`);
        }
        skip = false;
        inNormalBlock = true;
      } else {
        skip = true;
        inNormalBlock = false;
      }
      depth = 0;
      continue;
    }

    if (trimmed === '{') {
      depth++;
      if (!skip) out.push(line);
      continue;
    }
    if (trimmed === '}') {
      if (!skip) out.push(line);
      depth--;
      if (depth <= 0) {
        depth = 0;
        // After a block closes, reset: next block needs its own :normal selector
        skip = true;
        inNormalBlock = false;
      }
      continue;
    }

    if (skip) continue;
    if (/^\s*-fm-/.test(line)) continue;
    if (/line-height\s*:.*\bline\b/.test(line)) continue;
    if (/background-image\s*:\s*none/.test(line)) continue;
    if (/border-image/.test(line)) continue;

    out.push(line);
  }

  return out.join('\n');
}
