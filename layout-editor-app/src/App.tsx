import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { fetchLayoutInstructions, fetchLayoutDocs } from '@/api/client';
import { ChatPanel } from '@/ai/chat/ChatPanel';
import { AISettings } from '@/ai/settings/AISettings';
import { Canvas } from '@/canvas/Canvas';
import { Toolbar } from '@/toolbar/Toolbar';
import { Inspector } from '@/inspector/Inspector';
import { Palette } from '@/palette/Palette';
import { loadLayoutXML } from '@/xml/import';
import { exportToXML } from '@/xml/export';
import { useHistory } from '@/hooks/useHistory';
import { useThemeCSS } from '@/hooks/useThemeCSS';
import { useUnit } from '@/hooks/useUnit';
import type { LayoutState, LayoutObject } from '@/xml/import';

const EMPTY: LayoutState = { width: 760, parts: [], objects: [], popoverPanels: [] };

export function App() {
  const [themes, setThemes] = useState<{ name: string; source: 'default' | 'custom' | 'override' }[]>([]);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  useThemeCSS(activeTheme);  // theme is always driven by context, not user preference
  const { unit, setUnit } = useUnit();
  const { current: state, push, undo, redo, canUndo, canRedo } = useHistory<LayoutState>(EMPTY);
  const [loadError, setLoadError] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [layoutName, setLayoutName] = useState('');
  const [selected, setSelected] = useState<LayoutObject | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copyMsg, setCopyMsg] = useState('');
  const [showGrid, setShowGrid] = useState(false);
  const [previewState, setPreviewState] = useState('normal');
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const [availableFields, setAvailableFields] = useState<{ table: string; name: string; type: string }[]>([]);
  const [rightPanelWidth, setRightPanelWidth] = useState(288); // 72 * 4 = 288px
  const isResizing = useRef(false);
  const activeLayoutName = useRef(''); // tracks the current layout for change detection

  const handleResizeStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = rightPanelWidth;
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX - e.clientX;
      setRightPanelWidth(Math.max(220, Math.min(600, startWidth + delta)));
    };
    const onUp = () => {
      isResizing.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rightPanelWidth]);

  const LAYOUT_STORAGE_KEY = (name: string) => `layout-editor-state:${name}`;

  const loadLayoutFromServer = useCallback(async (layoutName: string) => {
    setLoadError('');
    try {
      const r = await fetch('/api/layout-xml');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const xml = await r.text();
      const s = loadLayoutXML(xml);
      if (!s) throw new Error('Failed to parse layout XML');
      localStorage.removeItem(LAYOUT_STORAGE_KEY(layoutName));
      push(s);
    } catch (e) {
      setLoadError(String(e));
    }
  }, [push]);

  const applyLayout = useCallback((name: string, fromServer: boolean) => {
    if (!fromServer) {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY(name));
      if (saved) {
        try {
          const s: LayoutState = JSON.parse(saved);
          push(s);
          return;
        } catch { /* fall through to server */ }
      }
    }
    loadLayoutFromServer(name);
  }, [push, loadLayoutFromServer]);

  const handleReset = useCallback(() => {
    loadLayoutFromServer(activeLayoutName.current);
  }, [loadLayoutFromServer]);

  // Persist state changes to localStorage
  useEffect(() => {
    if (!activeLayoutName.current || state.objects.length === 0) return;
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY(activeLayoutName.current), JSON.stringify(state));
    } catch { /* quota */ }
  }, [state]);

  // Initial load + context polling for layout changes
  useEffect(() => {
    Promise.all([fetchLayoutInstructions(), fetchLayoutDocs()]).then(([instructions, docs]) => {
      const combined = [docs, instructions].filter(Boolean).join('\n\n');
      setCustomInstructions(combined);
    }).catch(() => {});

    fetch('/api/themes').then(r => r.ok ? r.json() : [])
      .then((list: { name: string; source: 'default' | 'custom' | 'override' }[]) => {
        setThemes(list);
        if (list.length > 0) setActiveTheme(list[0].name);
      }).catch(() => {});

    const checkContext = async (isFirst: boolean) => {
      try {
        const [ctx, fields] = await Promise.all([
          fetch('/api/context').then(r => r.ok ? r.json() : null),
          fetch('/api/fields').then(r => r.ok ? r.json() : []),
        ]);
        const name: string = ctx?.current_layout?.name ?? '';
        if (fields?.length) setAvailableFields(fields);
        if (!name) return;

        if (name !== activeLayoutName.current) {
          // Layout changed — load fresh from server
          activeLayoutName.current = name;
          setLayoutName(name);
          applyLayout(name, !isFirst); // first load: try cache; layout change: always server
        }
      } catch { /* ignore poll errors */ }
    };

    checkContext(true);
    const poll = setInterval(() => checkContext(false), 5000);
    return () => clearInterval(poll);
  }, []);

  const handleStateChange = useCallback((next: LayoutState) => {
    push(next);
    setSelected(prev => {
      if (!prev) return null;
      return next.objects.find(o => o.id === prev.id)
        ?? next.popoverPanels.flatMap(p => p.children ?? []).find(o => o.id === prev.id)
        ?? null;
    });
  }, [push]);

  const handleAddObject = useCallback((spec: Partial<LayoutObject>, x: number, y: number) => {
    const newObj: LayoutObject = {
      id: 'new-' + Math.random().toString(36).slice(2, 8),
      fmId: '0',
      fmName: spec.fmName ?? '',
      type: spec.type ?? 'text',
      bounds: { top: y, left: x, bottom: y + (spec.height ?? 22), right: x + (spec.width ?? 140) },
      x, y,
      width: spec.width ?? 140,
      height: spec.height ?? 22,
      displayText: spec.displayText,
      fieldRef: spec.fieldRef,
    };
    push({ ...state, objects: [...state.objects, newObj] });
    setSelected(newObj);
  }, [state, push]);

  const handleCopyXML = useCallback(async () => {
    const xml = exportToXML(state);
    try {
      const res = await fetch('/api/clipboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml }),
      });
      if (!res.ok) throw new Error(`companion ${res.status}`);
      setCopyMsg('Copied!');
    } catch {
      // Fallback to plain text if companion server is unreachable
      await navigator.clipboard.writeText(xml).catch(() => {});
      setCopyMsg('Copied as text');
    }
    setTimeout(() => setCopyMsg(''), 2000);
  }, [state]);

  const handleGroup = useCallback(() => {
    if (selectedIds.size < 2) return;
    const toGroup = state.objects.filter(o => selectedIds.has(o.id));
    if (toGroup.length < 2) return;
    const minX = Math.min(...toGroup.map(o => o.x));
    const minY = Math.min(...toGroup.map(o => o.y));
    const maxX = Math.max(...toGroup.map(o => o.x + o.width));
    const maxY = Math.max(...toGroup.map(o => o.y + o.height));
    const group: LayoutObject = {
      id: 'group-' + Math.random().toString(36).slice(2, 8),
      fmId: '0', fmName: '',
      type: 'group',
      bounds: { top: minY, left: minX, bottom: maxY, right: maxX },
      x: minX, y: minY,
      width: maxX - minX, height: maxY - minY,
      children: toGroup.map(o => ({ ...o, x: o.x - minX, y: o.y - minY })),
    };
    push({ ...state, objects: [...state.objects.filter(o => !selectedIds.has(o.id)), group] });
    setSelectedIds(new Set([group.id]));
  }, [state, selectedIds, push]);

  const handleUngroup = useCallback(() => {
    const isUngroupable = (o: LayoutObject) =>
      selectedIds.has(o.id) && o.type === 'group';
    const expandGroup = (group: LayoutObject) =>
      (group.children ?? []).map(c => ({
        ...c,
        id: 'obj-' + Math.random().toString(36).slice(2, 8),
        x: group.x + c.x, y: group.y + c.y,
        bounds: { top: group.y + c.y, left: group.x + c.x, bottom: group.y + c.y + c.height, right: group.x + c.x + c.width },
      }));

    // Top-level objects
    const topGroups = state.objects.filter(isUngroupable);

    // Popover panel children
    const panelGroups: { panelId: string; group: LayoutObject }[] = [];
    for (const panel of state.popoverPanels) {
      for (const child of panel.children ?? []) {
        if (isUngroupable(child)) panelGroups.push({ panelId: panel.id, group: child });
      }
    }

    if (topGroups.length === 0 && panelGroups.length === 0) return;

    const topGroupIds = new Set(topGroups.map(g => g.id));
    const topUngrouped = topGroups.flatMap(expandGroup);

    const panelGroupIds = new Set(panelGroups.map(pg => pg.group.id));
    const newPopoverPanels = state.popoverPanels.map(panel => {
      const toExpand = panelGroups.filter(pg => pg.panelId === panel.id);
      if (toExpand.length === 0) return panel;
      const expandIds = new Set(toExpand.map(pg => pg.group.id));
      const kept = (panel.children ?? []).filter(c => !expandIds.has(c.id));
      const added = toExpand.flatMap(pg => expandGroup(pg.group));
      return { ...panel, children: [...kept, ...added] };
    });

    const allUngrouped = [...topUngrouped, ...panelGroups.flatMap(pg => expandGroup(pg.group))];
    push({
      ...state,
      objects: [...state.objects.filter(o => !topGroupIds.has(o.id)), ...topUngrouped],
      popoverPanels: newPopoverPanels,
    });
    setSelectedIds(new Set(allUngrouped.map(o => o.id)));
  }, [state, selectedIds, push]);

  const handleDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const next: LayoutState = {
      ...state,
      objects: state.objects.filter(o => !selectedIds.has(o.id)),
      popoverPanels: state.popoverPanels.map(panel => ({
        ...panel,
        children: (panel.children ?? []).filter(c => !selectedIds.has(c.id)),
      })),
    };
    push(next);
    setSelected(null);
    setSelectedIds(new Set());
  }, [state, selectedIds, push]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.metaKey && e.key === 'z' &&  e.shiftKey) { e.preventDefault(); redo(); }
      if (e.metaKey && e.key === 'g' && !e.shiftKey) { e.preventDefault(); handleGroup(); }
      if (e.metaKey && e.key === 'g' &&  e.shiftKey) { e.preventDefault(); handleUngroup(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); handleDelete();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, handleGroup, handleUngroup, handleDelete]);

  const loaded = state.objects.length > 0 || state.parts.length > 0;

  return (
    <div class="flex flex-col h-screen bg-neutral-900 text-neutral-100 overflow-hidden">
      <Toolbar
        layoutName={layoutName}
        objectCount={state.objects.length}
        partCount={state.parts.length}
        canvasWidth={state.width}
        canUndo={canUndo}
        canRedo={canRedo}
        showGrid={showGrid}
        copyMsg={copyMsg}
        canGroup={selectedIds.size >= 2}
        canUngroup={selectedIds.size >= 1 && [...selectedIds].every(id => {
          const o = state.objects.find(x => x.id === id)
            ?? state.popoverPanels.flatMap(p => p.children ?? []).find(x => x.id === id);
          return o?.type === 'group';
        })}
        themes={themes}
        activeTheme={activeTheme}
        onThemeChange={setActiveTheme}
        unit={unit}
        onUnitChange={setUnit}
        onUndo={undo}
        onRedo={redo}
        onToggleGrid={() => setShowGrid(g => !g)}
        onCopyXML={handleCopyXML}
        onGroup={handleGroup}
        onUngroup={handleUngroup}
        onReset={handleReset}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div class="flex flex-1 min-h-0">
        {/* Palette */}
        <div class="w-52 flex-shrink-0">
          <Palette state={state} onStateChange={handleStateChange} />
        </div>

        {/* Canvas */}
        <div class="flex-1 overflow-auto bg-neutral-400 py-6 flex items-start">
          {loaded ? (
            <Canvas
              state={state}
              onStateChange={handleStateChange}
              onSelect={setSelected}
              onSelectionChange={setSelectedIds}
              showGrid={showGrid}
              openPopover={openPopover}
              onOpenPopover={setOpenPopover}
              previewState={previewState}
              onAddObject={handleAddObject}
              unit={unit}
            />
          ) : loadError ? (
            <div class="flex flex-col items-center justify-center gap-2 text-sm">
              <span class="text-red-400 font-medium">Could not load layout</span>
              <span class="text-neutral-500 text-xs max-w-sm text-center">{loadError}</span>
            </div>
          ) : (
            <div class="flex items-center justify-center text-neutral-500 text-sm">
              Loading layout...
            </div>
          )}
        </div>

        {/* Right panel: Inspector + Chat */}
        <div
          class="flex-shrink-0 flex flex-col border-l border-neutral-700 relative"
          style={{ width: `${rightPanelWidth}px` }}
        >
          {/* Resize handle */}
          <div
            class="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors z-10"
            onMouseDown={handleResizeStart}
          />
          {/* Inspector */}
          <div class="border-b border-neutral-700 bg-neutral-800">
            <div class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Inspector
            </div>
            <Inspector
              selected={selected}
              state={state}
              previewState={previewState}
              onPreviewStateChange={setPreviewState}
              onStateChange={handleStateChange}
              unit={unit}
            />
          </div>

          {/* Chat */}
          <div class="flex-1 min-h-0">
            <ChatPanel
              key={chatKey}
              layoutName={layoutName}
              state={state}
              customInstructions={customInstructions}
              availableFields={availableFields}
              onClearChat={() => setChatKey(k => k + 1)}
              onStateChange={handleStateChange}
            />
          </div>
        </div>
      </div>

      {showSettings && (
        <AISettings onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
