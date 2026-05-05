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
    e.stopPropagation();

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
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onCommit]);

  const isDragging = (id: string) => drag.current?.id === id;

  return { startDrag, isDragging };
}
