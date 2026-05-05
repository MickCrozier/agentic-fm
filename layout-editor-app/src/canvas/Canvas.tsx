import { useCallback, useState } from 'preact/hooks';
import type { LayoutState, LayoutObject } from '@/xml/import';
import { CanvasObject } from './CanvasObject';
import { useSelection } from '@/hooks/useSelection';
import { useDrag } from '@/hooks/useDrag';

const PART_COLORS: Record<string, string> = {
  Header:       '#f0f4ff',
  Body:         '#ffffff',
  Footer:       '#f5f5f7',
  'Sub-summary':'#fffbf0',
  'Title Header':'#f0f4ff',
  'Title Footer':'#f5f5f7',
  'Grand Summary':'#f0fff4',
  'Leading Grand Summary':'#f0fff4',
  'Trailing Grand Summary':'#f0fff4',
};

interface CanvasProps {
  state: LayoutState;
  onStateChange: (next: LayoutState) => void;
  onSelect?: (obj: LayoutObject | null) => void;
  showGrid?: boolean;
  openPopover: string | null;
  onOpenPopover: (id: string | null) => void;
  onAddObject?: (spec: Partial<LayoutObject>, x: number, y: number) => void;
}

export function Canvas({ state, onStateChange, onSelect, showGrid = false, openPopover, onOpenPopover, onAddObject }: CanvasProps) {
  const { selected, select, clearSelection } = useSelection();
  const [dragPositions, setDragPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  const handleCommit = useCallback((id: string, x: number, y: number) => {
    // Check top-level objects first
    if (state.objects.some(o => o.id === id)) {
      const objects = state.objects.map(o => o.id === id ? { ...o, x, y } : o);
      onStateChange({ ...state, objects });
    } else {
      // Popover panel child — coords are panel-relative, store directly
      const popoverPanels = state.popoverPanels.map(panel => {
        if (!panel.children?.some(c => c.id === id)) return panel;
        return {
          ...panel,
          children: panel.children.map(c => c.id === id ? { ...c, x, y } : c),
        };
      });
      onStateChange({ ...state, popoverPanels });
    }
    setDragPositions(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, [state, onStateChange]);

  const { startDrag } = useDrag(handleCommit);

  const handleObjMouseDown = useCallback((e: MouseEvent, obj: LayoutObject) => {
    select(obj.id, e.metaKey || e.shiftKey);
    onSelect?.(obj);
    startDrag(e, obj, (x, y) => {
      setDragPositions(prev => new Map(prev).set(obj.id, { x, y }));
    });
  }, [select, onSelect, startDrag]);

  const handleObjDblClick = useCallback((obj: LayoutObject) => {
    if (obj.type === 'popover-btn') {
      onOpenPopover(openPopover === obj.id ? null : obj.id);
    }
  }, [openPopover, onOpenPopover]);

  const handleCanvasClick = useCallback((e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('canvas-root')) {
      clearSelection();
      onSelect?.(null);
      onOpenPopover(null);
    }
  }, [clearSelection, onSelect]);

  const canvasHeight = state.parts.length > 0
    ? Math.max(...state.parts.map(p => p.bottom))
    : 900;

  let partTop = 0;

  return (
    <div class="canvas-wrap">
      <div
        class="canvas-root"
        style={{ width: state.width + 'px', minHeight: canvasHeight + 'px' }}
        onClick={handleCanvasClick}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          const raw = e.dataTransfer?.getData('application/fm-object');
          if (!raw || !onAddObject) return;
          try {
            const spec = JSON.parse(raw);
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const x = Math.round(e.clientX - rect.left);
            const y = Math.round(e.clientY - rect.top);
            onAddObject(spec, x, y);
          } catch {}
        }}
      >
        {/* Part bands */}
        {state.parts.map((part, i) => {
          const top = partTop;
          const height = part.bottom - top;
          partTop = part.bottom;
          return (
            <div
              key={i}
              class="layout-part"
              style={{ top: top + 'px', height: height + 'px', background: PART_COLORS[part.type] ?? '#fff' }}
            >
              <span class="layout-part-label">{part.type}</span>
              <span class="layout-part-size">{height}px</span>
            </div>
          );
        })}

        {/* Layout objects */}
        {state.objects.map(obj => {
          const livePos = dragPositions.get(obj.id);
          const displayObj = livePos ? { ...obj, x: livePos.x, y: livePos.y } : obj;
          return (
            <CanvasObject
              key={obj.id}
              obj={displayObj}
              selected={selected.has(obj.id)}
              onMouseDown={handleObjMouseDown}
              onDblClick={handleObjDblClick}
            />
          );
        })}

        {/* Popover panels — only visible when their button is double-clicked */}
        {state.popoverPanels.map(panel => {
          if (openPopover !== panel.popoverPanelFor) return null;
          const btn = state.objects.find(o => o.id === panel.popoverPanelFor);
const panelLeft = btn ? btn.x : panel.bounds.left;
          const panelTop  = btn ? btn.y + btn.height : panel.bounds.top;
          return (
            <div
              key={panel.id}
              class="fm-object fm-popover-panel"
              style={{
                position: 'absolute',
                left: panelLeft + 'px',
                top: panelTop + 'px',
                width: panel.width + 'px',
                height: panel.height + 'px',
              }}
            >
              <div class="self" style={{ position: 'absolute', inset: '0', borderRadius: 'inherit' }} />
              <div class="fm-popover-title">{panel.popoverPanelTitle ?? 'Popover'}</div>
              {(panel.children ?? []).map(child => {
                const livePos = dragPositions.get(child.id);
                const displayChild = livePos ? { ...child, x: livePos.x, y: livePos.y } : child;
                return (
                  <CanvasObject
                    key={child.id}
                    obj={displayChild}
                    selected={selected.has(child.id)}
                    onMouseDown={handleObjMouseDown}
                    onDblClick={handleObjDblClick}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
