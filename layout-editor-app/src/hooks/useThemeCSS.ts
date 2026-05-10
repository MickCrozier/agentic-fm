import { useEffect } from 'preact/hooks';
import { convertThemeCSS } from '@/xml/convertThemeCSS';

const STYLE_ID = 'fm-theme-css';

function injectCSS(css: string) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function useThemeCSS(themeName: string | null) {
  useEffect(() => {
    if (!themeName) {
      const el = document.getElementById(STYLE_ID);
      if (el) el.textContent = '';
      return;
    }
    fetch(`/api/themes/${encodeURIComponent(themeName)}.css`)
      .then(r => r.ok ? r.text() : null)
      .then(raw => {
        if (!raw) return;
        injectCSS(convertThemeCSS(raw));
      })
      .catch(() => {});
  }, [themeName]);
}
