import { UNIT_LABELS, formatMeasure } from '@/utils/units';
import type { MeasureUnit } from '@/utils/units';

interface ToolbarProps {
  layoutName: string;
  objectCount: number;
  partCount: number;
  canvasWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  copyMsg: string;
  canGroup?: boolean;
  canUngroup?: boolean;
  unit: MeasureUnit;
  onUnitChange: (u: MeasureUnit) => void;
  themes: { name: string; source: 'default' | 'custom' | 'override' }[];
  activeTheme: string | null;
  onThemeChange: (t: string | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleGrid: () => void;
  onCopyXML: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onReset: () => void;
  onOpenSettings: () => void;
}

export function Toolbar({
  layoutName, objectCount, partCount, canvasWidth,
  canUndo, canRedo, showGrid, copyMsg,
  canGroup, canUngroup,
  unit, onUnitChange,
  themes, activeTheme, onThemeChange,
  onUndo, onRedo, onToggleGrid, onCopyXML, onGroup, onUngroup, onReset, onOpenSettings,
}: ToolbarProps) {
  return (
    <div class="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 border-b border-neutral-700 text-xs select-none flex-shrink-0">
      <span class="font-semibold text-neutral-200 min-w-0 truncate max-w-[200px]" title={layoutName}>
        {layoutName || 'FM Layout Editor'}
      </span>
      <span class="text-neutral-600">|</span>
      <span class="text-neutral-500 whitespace-nowrap">{objectCount} obj · {partCount} parts · {formatMeasure(canvasWidth, unit)}</span>

      <span class="flex-1" />

      {/* Undo / Redo */}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        class="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-400 disabled:opacity-30"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M3 7v6h6"/><path d="M3 13C5 7 11 3 18 6"/>
        </svg>
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (⌘⇧Z)"
        class="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-400 disabled:opacity-30"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M21 7v6h-6"/><path d="M21 13C19 7 13 3 6 6"/>
        </svg>
      </button>

      <span class="text-neutral-600">|</span>

      {/* Grid toggle */}
      <button
        onClick={onToggleGrid}
        title="Toggle grid"
        class={`w-6 h-6 flex items-center justify-center rounded ${showGrid ? 'bg-blue-700 text-white' : 'hover:bg-neutral-700 text-neutral-400'}`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
        </svg>
      </button>

      <span class="text-neutral-600">|</span>

      {/* Unit selector */}
      <div class="flex rounded overflow-hidden border border-neutral-600">
        {UNIT_LABELS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onUnitChange(value)}
            class={`px-1.5 py-0.5 text-[10px] leading-none ${
              unit === value
                ? 'bg-blue-700 text-white'
                : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {themes.length > 0 && (
        <>
          <span class="text-neutral-600">|</span>
          <select
            value={activeTheme ?? ''}
            onChange={e => {
              const v = (e.target as HTMLSelectElement).value;
              onThemeChange(v || null);
            }}
            class="bg-neutral-700 text-neutral-200 text-[10px] rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-500 max-w-[160px]"
            title="Active theme"
          >
            <option value="">No theme</option>
            {themes.map(t => (
              <option key={t.name} value={t.name}>
                {t.source === 'override' ? `${t.name} ●` : t.name}
              </option>
            ))}
          </select>
        </>
      )}

      <span class="text-neutral-600">|</span>

      {/* Group / Ungroup */}
      <button
        onClick={onGroup}
        disabled={!canGroup}
        title="Group (⌘G)"
        class="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-400 disabled:opacity-30"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/>
          <rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/>
          <rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="3 2"/>
        </svg>
      </button>
      <button
        onClick={onUngroup}
        disabled={!canUngroup}
        title="Ungroup (⌘⇧G)"
        class="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-400 disabled:opacity-30"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/>
          <rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/>
        </svg>
      </button>

      <span class="flex-1" />

      {copyMsg && <span class="text-green-400 font-medium">{copyMsg}</span>}

      <button
        onClick={onReset}
        class="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300"
        title="Discard changes and reload from FileMaker"
      >
        Reset
      </button>
      <button
        onClick={onCopyXML}
        class="px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white"
      >
        Copy XML
      </button>
      <button
        onClick={onOpenSettings}
        class="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-400"
        title="Settings"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>
  );
}
