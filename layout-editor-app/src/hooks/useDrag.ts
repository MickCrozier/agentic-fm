import { useRef, useCallback } from 'preact/hooks';
import type { LayoutObject } from '@/xml/import';

export function useDrag(
  onCommit: (id: string, x: number, y: number) => void,
) {
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    onLiveMove: (x: number, y: number) => void;
  } | null>(null);

  const startDrag = useCallback((
    e: MouseEvent,
    obj: LayoutObject,
    onLiveMove: (x: number, y: number) => void,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // No stopPropagation — Preact delegates events through document, so
    // stopping propagation here would also kill the document mousemove/mouseup
    // listeners we register below.

    drag.current = {
      id: obj.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: obj.x,
      origY: obj.y,
      onLiveMove,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      const x = drag.current.origX + ev.clientX - drag.current.startX;
      const y = drag.current.origY + ev.clientY - drag.current.startY;
      drag.current.onLiveMove(Math.round(x), Math.round(y));
    };

    const onMouseUp = (ev: MouseEvent) => {
      if (!drag.current) return;
      const x = drag.current.origX + ev.clientX - drag.current.startX;
      const y = drag.current.origY + ev.clientY - drag.current.startY;
      onCommit(drag.current.id, Math.round(x), Math.round(y));
      drag.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [onCommit]);

  const isDragging = (id: string) => drag.current?.id === id;

  return { startDrag, isDragging };
}
