import { useState, useCallback } from 'preact/hooks';

export function useHistory<T>(initial: T) {
  const [hist, setHist] = useState<{ stack: T[]; cursor: number }>({
    stack: [initial],
    cursor: 0,
  });

  // Stable forever — no deps. Uses functional update so it always sees the latest cursor.
  const push = useCallback((next: T) => {
    setHist(prev => {
      const stack = [...prev.stack.slice(0, prev.cursor + 1), next];
      return { stack, cursor: prev.cursor + 1 };
    });
  }, []);

  const undo = useCallback(() => {
    setHist(prev => ({ ...prev, cursor: Math.max(0, prev.cursor - 1) }));
  }, []);

  const redo = useCallback(() => {
    setHist(prev => ({ ...prev, cursor: Math.min(prev.stack.length - 1, prev.cursor + 1) }));
  }, []);

  return {
    current: hist.stack[hist.cursor],
    push,
    undo,
    redo,
    canUndo: hist.cursor > 0,
    canRedo: hist.cursor < hist.stack.length - 1,
  };
}
