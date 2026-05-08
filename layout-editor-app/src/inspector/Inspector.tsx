import { useCallback } from 'preact/hooks';
import type { LayoutObject, LayoutState } from '@/xml/import';
import type { FMStyles } from '@/xml/parseFMCSS';

interface InspectorProps {
  selected: LayoutObject | null;
  state: LayoutState;
  onStateChange: (next: LayoutState) => void;
}

export function Inspector({ selected, state, onStateChange }: InspectorProps) {
  const update = useCallback((patch: Partial<LayoutObject>) => {
    if (!selected) return;
    // Check top-level objects
    if (state.objects.some(o => o.id === selected.id)) {
      const objects = state.objects.map(o => o.id === selected.id ? { ...o, ...patch } : o);
      onStateChange({ ...state, objects });
      return;
    }
    // Check popover panel children
    const popoverPanels = state.popoverPanels.map(panel => {
      if (!panel.children?.some(c => c.id === selected.id)) return panel;
      return { ...panel, children: panel.children.map(c => c.id === selected.id ? { ...c, ...patch } : c) };
    });
    onStateChange({ ...state, popoverPanels });
  }, [selected, state, onStateChange]);

  const numInput = (label: string, value: number, onChange: (v: number) => void) => (
    <label class="flex items-center gap-1">
      <span class="text-neutral-500 w-4 text-right text-[10px]">{label}</span>
      <input
        type="number"
        value={value}
        onInput={e => onChange(parseInt((e.target as HTMLInputElement).value, 10) || 0)}
        class="w-16 bg-neutral-700 text-neutral-200 text-xs rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-500"
      />
    </label>
  );

  const textInput = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <div class="text-[10px] text-neutral-500 uppercase tracking-wide mb-0.5">{label}</div>
      <input
        type="text"
        value={value}
        onInput={e => onChange((e.target as HTMLInputElement).value)}
        class="w-full bg-neutral-700 text-neutral-200 text-xs rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );

  const calcInput = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <div class="text-[10px] text-neutral-500 uppercase tracking-wide mb-0.5">{label}</div>
      <textarea
        value={value}
        onInput={e => onChange((e.target as HTMLTextAreaElement).value)}
        rows={2}
        class="w-full bg-neutral-700 text-neutral-200 text-xs rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500 font-mono resize-none"
      />
    </div>
  );

  if (!selected) {
    return (
      <div class="px-3 py-3 text-xs text-neutral-600 italic">
        No object selected
      </div>
    );
  }

  const showDisplayText  = selected.type === 'button' || selected.type === 'text';
  const showFieldRef     = selected.type === 'field';

  return (
    <div class="px-3 py-2 text-xs space-y-2.5 overflow-y-auto max-h-full">
      {/* Type badge */}
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 bg-neutral-700 rounded px-1.5 py-0.5">
          {selected.type}
        </span>
        <span class="text-neutral-600 text-[10px]">FM #{selected.fmId}</span>
      </div>

      {/* Object name */}
      {textInput('Object Name', selected.fmName, v => update({ fmName: v }))}

      {/* Field ref (read-only display) */}
      {showFieldRef && selected.fieldRef && (
        <div>
          <div class="text-[10px] text-neutral-500 uppercase tracking-wide mb-0.5">Field</div>
          <div class="text-blue-300 bg-neutral-800 rounded px-2 py-1 font-mono text-[10px] truncate" title={selected.fieldRef}>
            {selected.fieldRef}
          </div>
        </div>
      )}

      {/* Display text for buttons and text labels */}
      {showDisplayText && textInput('Text', selected.displayText ?? '', v => update({ displayText: v }))}

      {/* Tooltip */}
      {calcInput('Tooltip', selected.tooltip ?? '', v => update({ tooltip: v || undefined }))}

      {/* Hide condition */}
      {calcInput('Hide Condition', selected.hideCondition ?? '', v => update({ hideCondition: v || undefined }))}

      {/* Position */}
      <div>
        <div class="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Position</div>
        <div class="flex flex-wrap gap-2">
          {numInput('X', selected.x, v => update({ x: v }))}
          {numInput('Y', selected.y, v => update({ y: v }))}
        </div>
      </div>

      {/* Size */}
      <div>
        <div class="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Size</div>
        <div class="flex flex-wrap gap-2">
          {numInput('W', selected.width,  v => update({ width: v }))}
          {numInput('H', selected.height, v => update({ height: v }))}
        </div>
      </div>

      {/* Style */}
      <StyleSection selected={selected} />
    </div>
  );
}

const LOCAL_STYLE_LABELS: Partial<Record<keyof FMStyles, string>> = {
  backgroundColor: 'Fill',
  color:           'Text color',
  fontSize:        'Font size',
  fontWeight:      'Weight',
  fontFamily:      'Font',
  textAlign:       'Align',
  verticalAlign:   'V-align',
  borderRadius:    'Corner radius',
  boxShadow:       'Shadow',
  borderTopWidth:      'Border top',
  borderRightWidth:    'Border right',
  borderBottomWidth:   'Border bottom',
  borderLeftWidth:     'Border left',
};

function StyleSection({ selected }: { selected: LayoutObject }) {
  const hasTheme  = !!selected.themeClass;
  const local     = selected.localStyles ?? {};
  const localKeys = Object.keys(local) as (keyof FMStyles)[];
  const hasLocal  = localKeys.length > 0;

  if (!hasTheme && !hasLocal) return null;

  return (
    <div>
      <div class="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Style</div>
      <div class="space-y-1">
        {hasTheme && (
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] px-1 py-0.5 rounded bg-blue-900 text-blue-300 font-medium">theme</span>
            <span class="text-neutral-400 text-[10px] font-mono truncate">{selected.themeClass}</span>
          </div>
        )}
        {hasLocal && (
          <div class="space-y-0.5">
            {localKeys.map(key => (
              <div key={key} class="flex items-center gap-1.5">
                <span class="text-[9px] px-1 py-0.5 rounded bg-amber-900 text-amber-300 font-medium">local</span>
                <span class="text-neutral-500 text-[10px] w-24 flex-shrink-0">{LOCAL_STYLE_LABELS[key] ?? key}</span>
                <span class="text-neutral-300 text-[10px] font-mono break-all">{String(local[key])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
