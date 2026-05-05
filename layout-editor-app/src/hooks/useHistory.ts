import { useState, useCallback } from 'preact/hooks';

export function useHistory<T>(initial: T) {
  const [stack, setStack] = useState<T[]>([initial]);
  const [cursor, setCursor] = useState(0);

  const current = stack[cursor];

  const push = useCallback((next: T) => {
    setStack(prev => [...prev.slice(0, cursor + 1), next]);
    setCursor(c => c + 1);
  }, [cursor]);

  const undo = useCallback(() => {
    setCursor(c => Math.max(0, c - 1));
  }, []);

  const redo = useCallback(() => {
    setStack(prev => {
      setCursor(c => Math.min(prev.length - 1, c + 1));
      return prev;
    });
  }, []);

  const canUndo = cursor > 0;
  const canRedo = cursor < stack.length - 1;

  return { current, push, undo, redo, canUndo, canRedo };
}
