import { useCallback, useEffect, useState } from 'preact/hooks';
import type { LayoutState, LayoutObject } from '@/xml/import';
import { CanvasObject } from './CanvasObject';
import { useSelection } from '@/hooks/useSelection';
import { useDrag } from '@/hooks/useDrag';
import { formatMeasure } from '@/utils/units';
import type { MeasureUnit } from '@/utils/units';

const PART_THEME_CLASS: Record<string, string> = {
  'Header':                   'header',
  'Body':                     'body',
  'Footer':                   'footer',
  'Title Header':             'title_header',
  'Title Footer':             'title_footer',
  'Top Navigation':           'top_nav_part',
  'Bottom Navigation':        'bottom_nav_part',
  'Sub-summary':              'leading_sub_summary',
  'Leading Sub-summary':      'leading_sub_summary',
  'Trailing Sub-summary':     'trailing_sub_summary',
  'Grand Summary':            'body',
  'Leading Grand Summary':    'leading_sub_summary',
  'Trailing Grand Summary':   'trailing_sub_summary',
};

interface CanvasProps {
  state: LayoutState;
  onStateChange: (next: LayoutState) => void;
  previewState?: string;
  onSelect?: (obj: LayoutObject | null) => void;
  onSelectionChange?: (ids: Set<string>) => void;
  showGrid?: boolean;
  openPopover: string | null;
  onOpenPopover: (id: string | null) => void;
  onAddObject?: (spec: Partial<LayoutObject>, x: number, y: number) => void;
  unit?: MeasureUnit;
}

export function Canvas({ state, onStateChange, previewState, onSelect, onSelectionChange, showGrid = false, openPopover, onOpenPopover, onAddObject, unit = 'pt' }: CanvasProps) {
  const { selected, select, clearSelection } = useSelection();

  useEffect(() => {
    onSelectionChange?.(selected);
  }, [selected]);
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

  // Part boundary drag — same pattern as width drag: snapshot originals at mousedown,
  // compute total delta from mousedown clientY each frame.
  const handlePartBoundaryMouseDown = useCallback((e: MouseEvent, idx: number) => {
    e.preventDefault();

    const mouseDownY = e.clientY;
    const origParts   = state.parts.map(p => ({ ...p }));
    const origObjects = state.objects.map(o => ({ ...o, bounds: { ...o.bounds } }));

    const partTop = idx === 0 ? 0 : origParts[idx - 1].bottom;

    // Upward constraint: don't let the boundary go above fully-contained objects
    const objsInPart = origObjects.filter(
      o => o.y >= partTop && (o.y + o.height) <= origParts[idx].bottom,
    );
    const minBottom = objsInPart.length > 0
      ? Math.max(partTop + 16, Math.max(...objsInPart.map(o => o.y + o.height)))
      : partTop + 16;

    const origBottom = origParts[idx].bottom;

    const onMove = (me: MouseEvent) => {
      const totalDelta = me.clientY - mouseDownY;
      const newBottom = Math.max(minBottom, Math.round(origBottom + totalDelta));
      const dy = newBottom - origBottom;

      const newParts = origParts.map((p, i) =>
        i >= idx ? { ...p, bottom: p.bottom + dy } : p,
      );
      const newObjects = origObjects.map(o =>
        o.y >= origBottom
          ? { ...o, y: o.y + dy, bounds: { ...o.bounds, top: o.bounds.top + dy, bottom: o.bounds.bottom + dy } }
          : o,
      );
      onStateChange({ ...state, parts: newParts, objects: newObjects });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [state, onStateChange]);

  // Right-edge (width) drag — mirrors HTML reference: snapshot startX/startW at mousedown,
  // compute total delta each frame, register on document so moves outside the element work.
  const handleWidthHandleMouseDown = useCallback((e: MouseEvent) => {
    if ((e as MouseEvent & { button: number }).button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = state.width;
    const onMove = (me: MouseEvent) => {
      const newWidth = Math.max(200, Math.round(startW + (me.clientX - startX)));
      onStateChange({ ...state, width: newWidth });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [state, onStateChange]);

  const canvasHeight = state.parts.length > 0
    ? Math.max(...state.parts.map(p => p.bottom))
    : 900;

  let partTop = 0;

  return (
    <div class="canvas-wrap mx-auto">
      <div
        class="canvas-root"
        style={{ position: 'relative', width: state.width + 'px', minHeight: canvasHeight + 'px' }}
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
          const partTheme = PART_THEME_CLASS[part.type];
          return (
            <div
              key={i}
              class={`layout-part${partTheme ? ` fm-theme-${partTheme}` : ''}`}
              style={{ top: top + 'px', height: height + 'px' }}
            >
              <div class="self" style={{ position: 'absolute', inset: '0' }} />
              <span class="layout-part-label">{part.type}</span>
              <span class="layout-part-size">{formatMeasure(height, unit)}</span>
            </div>
          );
        })}

        {/* Part boundary dividers — siblings of part bands so pointer-events aren't blocked */}
        {state.parts.map((part, i) => (
          <div
            key={'div-' + i}
            class="part-divider"
            style={{ top: part.bottom + 'px' }}
            onMouseDown={e => handlePartBoundaryMouseDown(e, i)}
          />
        ))}

        {/* Right-edge width handle — inside canvas-root so it's relatively positioned */}
        <div
          class="canvas-width-handle"
          onMouseDown={handleWidthHandleMouseDown}
          title="Drag to resize layout width"
        />

        {/* Layout objects */}
        {state.objects.map(obj => {
          const livePos = dragPositions.get(obj.id);
          const displayObj = livePos ? { ...obj, x: livePos.x, y: livePos.y } : obj;
          return (
            <CanvasObject
              key={obj.id}
              obj={displayObj}
              selected={selected.has(obj.id)}
              previewState={selected.has(obj.id) ? previewState : undefined}
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
