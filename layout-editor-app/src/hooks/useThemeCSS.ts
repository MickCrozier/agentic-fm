import { useEffect } from 'preact/hooks';
import { convertThemeCSS } from '@/xml/convertThemeCSS';

const STYLE_ID = 'fm-theme-css';

export function useThemeCSS() {
  useEffect(() => {
    fetch('/api/theme.css')
      .then(r => {
        console.log('[theme] fetch status:', r.status, r.ok);
        return r.ok ? r.text() : null;
      })
      .then(raw => {
        if (!raw) { console.warn('[theme] no CSS received'); return; }
        console.log('[theme] raw CSS length:', raw.length);
        const converted = convertThemeCSS(raw);
        console.log('[theme] converted CSS length:', converted.length, 'first 200:', converted.slice(0, 200));
        let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
        if (!el) {
          el = document.createElement('style');
          el.id = STYLE_ID;
          document.head.appendChild(el);
        }
        el.textContent = converted;
        console.log('[theme] injected into <head>');
      })
      .catch(e => console.error('[theme] fetch error:', e));
  }, []);
}
