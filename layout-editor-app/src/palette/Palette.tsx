import { useState, useEffect } from 'preact/hooks';
import type { LayoutObject, LayoutState } from '@/xml/import';

interface FMField {
  name: string;
  type: string;
  table: string;
}

interface PaletteProps {
  state: LayoutState;
  onStateChange: (next: LayoutState) => void;
}

const SHAPE_TYPES: { label: string; type: LayoutObject['type'] }[] = [
  { label: 'Text Label', type: 'text' },
  { label: 'Button',     type: 'button' },
  { label: 'Rectangle',  type: 'rectangle' },
  { label: 'Line',       type: 'line' },
];

function makeId() {
  return 'new-' + Math.random().toString(36).slice(2, 8);
}

export function Palette({ state, onStateChange }: PaletteProps) {
  const [fields, setFields] = useState<FMField[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'fields' | 'shapes'>('fields');

  useEffect(() => {
    fetch('/api/context')
      .then(r => r.ok ? r.json() : null)
      .then((ctx: {
        current_layout?: { base_to: string };
        tables?: Record<string, { to: string; fields: Record<string, { type: string }> }>;
      } | null) => {
        if (!ctx?.tables) return;
        const baseTo = ctx.current_layout?.base_to ?? '';
        const list: FMField[] = [];

        // Base TO first, then related TOs
        const tableOrder = Object.keys(ctx.tables).sort((a, b) => {
          if (a === baseTo) return -1;
          if (b === baseTo) return 1;
          return a.localeCompare(b);
        });

        for (const table of tableOrder) {
          const tdef = ctx.tables[table];
          for (const [name, fdef] of Object.entries(tdef.fields)) {
            // Skip FM separator pseudo-fields — they contain dashes/equals as majority of chars
            const stripped = name.replace(/[-_=\s|]/g, '');
            if (stripped.length < name.length * 0.5) continue;
            list.push({ name, type: fdef.type, table: tdef.to ?? table });
          }
        }
        setFields(list);
      })
      .catch(() => {});
  }, []);

  const addObject = (obj: Partial<LayoutObject>) => {
    const newObj: LayoutObject = {
      id: makeId(),
      fmId: '0',
      fmName: obj.fmName ?? '',
      type: obj.type ?? 'text',
      bounds: { top: 20, left: 20, bottom: 40, right: 140 },
      x: 20, y: 20,
      width:  obj.width  ?? 120,
      height: obj.height ?? 20,
      displayText: obj.displayText,
      fieldRef: obj.fieldRef,
    };
    onStateChange({ ...state, objects: [...state.objects, newObj] });
  };

  const filtered = fields.filter(f =>
    !search || f.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div class="flex flex-col h-full bg-neutral-850 border-r border-neutral-700 text-xs">
      {/* Tab strip */}
      <div class="flex border-b border-neutral-700">
        {(['fields', 'shapes'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            class={`flex-1 py-1.5 text-[11px] font-medium capitalize ${
              activeTab === tab
                ? 'text-neutral-200 border-b-2 border-blue-500'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'fields' && (
        <>
          <div class="px-2 py-1.5">
            <input
              type="search"
              placeholder="Search fields..."
              value={search}
              onInput={e => setSearch((e.target as HTMLInputElement).value)}
              class="w-full bg-neutral-700 text-neutral-200 rounded px-2 py-1 text-xs outline-none placeholder:text-neutral-500"
            />
          </div>
          <div class="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div class="px-3 py-4 text-neutral-600 italic">No fields</div>
            )}
            {groupByTable(filtered).map(({ table, fields: group }) => (
              <div key={table}>
                <div class="px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-neutral-600 bg-neutral-800 sticky top-0">
                  {table}
                </div>
                {group.map(f => (
                  <button
                    key={`${f.table}::${f.name}`}
                    draggable
                    onDragStart={e => e.dataTransfer?.setData('application/fm-object', JSON.stringify({
                      type: 'field', fmName: f.name, fieldRef: `${f.table}::${f.name}`, width: 140, height: 22,
                    }))}
                    onClick={() => addObject({
                      type: 'field',
                      fmName: f.name,
                      fieldRef: `${f.table}::${f.name}`,
                      width: 140, height: 22,
                    })}
                    class="w-full flex items-center gap-2 px-2 py-1 hover:bg-neutral-700 text-left group cursor-grab active:cursor-grabbing"
                    title={`${f.table}::${f.name}`}
                  >
                    <span class="text-[9px] text-neutral-600 w-7 flex-shrink-0 font-mono">{shortType(f.type)}</span>
                    <span class="text-neutral-300 truncate group-hover:text-neutral-100 text-[11px]">{f.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'shapes' && (
        <div class="p-2 space-y-1">
          {SHAPE_TYPES.map(s => (
            <button
              key={s.type}
              draggable
              onDragStart={e => e.dataTransfer?.setData('application/fm-object', JSON.stringify({
                type: s.type, displayText: s.label, width: 120, height: 24,
              }))}
              onClick={() => addObject({ type: s.type, displayText: s.label, width: 120, height: 24 })}
              class="w-full text-left px-3 py-2 rounded hover:bg-neutral-700 text-neutral-300 hover:text-neutral-100 cursor-grab active:cursor-grabbing"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function groupByTable(fields: FMField[]): { table: string; fields: FMField[] }[] {
  const map = new Map<string, FMField[]>();
  for (const f of fields) {
    if (!map.has(f.table)) map.set(f.table, []);
    map.get(f.table)!.push(f);
  }
  return Array.from(map.entries()).map(([table, fields]) => ({ table, fields }));
}

function shortType(t: string): string {
  const map: Record<string, string> = {
    Text: 'txt', Number: 'num', Date: 'date', Time: 'time',
    Timestamp: 'ts', Container: 'cont', Calculation: 'calc',
    Summary: 'sum', Global: 'g',
  };
  return map[t] ?? t.slice(0, 4).toLowerCase();
}
