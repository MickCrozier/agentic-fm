import { useState, useCallback } from 'preact/hooks';

export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const select = useCallback((id: string, multi: boolean) => {
    setSelected(prev => {
      if (multi) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  return { selected, select, clearSelection };
}
