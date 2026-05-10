import { useEffect, useState } from 'preact/hooks';

export function useThemeClasses(themeName: string | null, fmType: string | null): string[] {
  const [classes, setClasses] = useState<string[]>([]);

  useEffect(() => {
    if (!themeName || !fmType) { setClasses([]); return; }
    const url = `/api/theme-classes/${encodeURIComponent(themeName)}?fmType=${encodeURIComponent(fmType)}`;
    fetch(url)
      .then(r => r.ok ? r.json() : { classes: [] })
      .then(data => setClasses(data.classes ?? []))
      .catch(() => setClasses([]));
  }, [themeName, fmType]);

  return classes;
}
