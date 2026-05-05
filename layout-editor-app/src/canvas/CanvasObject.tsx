import type { LayoutObject } from '@/xml/import';

const TYPE_CLASS: Record<string, string> = {
  field:          'fm-field',
  text:           'fm-label',
  button:         'fm-button',
  line:           'fm-line',
  rectangle:      'fm-rect',
  portal:         'fm-portal',
  'web-viewer':   'fm-web-viewer',
  group:          'fm-group',
  'tab-control':  'fm-tab-control',
  'slide-control':'fm-slide-control',
  'popover-btn':  'fm-popover-btn',
  'popover-panel':'fm-popover-panel',
  unknown:        'fm-unknown',
};

// FM editor type → base theme CSS class name (provides type-level defaults)
const TYPE_THEME_BASE: Record<string, string> = {
  field:         'edit_box',
  text:          'text_box',
  button:        'button',
  'popover-btn': 'button',
  line:          'line',
  rectangle:     'rectangle',
  portal:        'portal',
  'web-viewer':  'web_viewer',
  'tab-control': 'tab_panel',
};

interface CanvasObjectProps {
  obj: LayoutObject;
  selected: boolean;
  onMouseDown: (e: MouseEvent, obj: LayoutObject) => void;
  onDblClick: (obj: LayoutObject) => void;
}

export function CanvasObject({ obj, selected, onMouseDown, onDblClick }: CanvasObjectProps) {
  const typeClass = TYPE_CLASS[obj.type] ?? 'fm-unknown';
  const s = obj.fmStyles ?? {};

  // Always apply the FM type base theme class for type-level defaults (text-align, align-items, etc.)
  // Then apply the object's specific themeClass on top (UUID or named style) — it wins via source order
  const baseTheme = TYPE_THEME_BASE[obj.type];
  const objTheme  = obj.themeClass;
  const themeClasses = [
    baseTheme ? `fm-theme-${baseTheme}` : '',
    objTheme && objTheme !== baseTheme ? `fm-theme-${objTheme}` : '',
  ].filter(Boolean).join(' ');
  const themeClass = themeClasses ? ` ${themeClasses}` : '';

  // Outer div: geometry + interaction only
  const outerStyle: Record<string, string> = {
    position: 'absolute',
    left:   obj.x + 'px',
    top:    obj.y + 'px',
    width:  obj.width + 'px',
    height: obj.height + 'px',
  };

  // .self: receives theme CSS base styles + LocalCSS inline overrides
  const selfStyle: Record<string, string> = {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };
  if (s.verticalAlign) {
    selfStyle.alignItems = s.verticalAlign === 'center' ? 'center'
      : s.verticalAlign === 'bottom' ? 'flex-end'
      : 'flex-start';
  }

  if (s.backgroundColor) selfStyle.backgroundColor = s.backgroundColor;
  if (s.color)           selfStyle.color = s.color;
  if (s.fontFamily)      selfStyle.fontFamily = s.fontFamily;
  if (s.fontSize)        selfStyle.fontSize = s.fontSize;
  if (s.fontWeight)      selfStyle.fontWeight = s.fontWeight;
  if (s.textAlign)       selfStyle.textAlign = s.textAlign;
  if (s.boxShadow)       selfStyle.boxShadow = s.boxShadow;

  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    const color = (s as Record<string, string>)[`border${side}Color`];
    const width = (s as Record<string, string>)[`border${side}Width`];
    const style = (s as Record<string, string>)[`border${side}Style`];
    if (color) selfStyle[`border${side}Color`] = color;
    if (width) selfStyle[`border${side}Width`] = width;
    if (style) selfStyle[`border${side}Style`] = style;
  }

  return (
    <div
      class={`fm-object ${typeClass}${themeClass}${selected ? ' selected' : ''}`}
      style={outerStyle}
      onMouseDown={(e) => onMouseDown(e as MouseEvent, obj)}
      onDblClick={(e) => { e.stopPropagation(); onDblClick(obj); }}
      title={obj.fmName || obj.type}
    >
      <div class="self" style={selfStyle}>
        {renderContent(obj)}
      </div>
    </div>
  );
}

function labelStyle(obj: LayoutObject): Record<string, string> {
  const style: Record<string, string> = {};
  if (obj.fmStyles?.textAlign) style.textAlign = obj.fmStyles.textAlign;
  return style;
}

function renderContent(obj: LayoutObject) {
  switch (obj.type) {
    case 'field':
      return <span class="fm-obj-label" style={labelStyle(obj)}>{obj.fieldRef?.split('::')[1] ?? obj.fmName ?? ''}</span>;
    case 'portal':
      return <PortalContent obj={obj} />;
    case 'tab-control':
      return <TabContent obj={obj} />;
    case 'slide-control':
      return <SlideContent obj={obj} />;
    case 'group':
      return <GroupContent obj={obj} />;
    case 'popover-panel':
      return null;
    default:
      return <span class="fm-obj-label" style={labelStyle(obj)}>{obj.displayText ?? ''}</span>;
  }
}

function GroupContent({ obj }: { obj: LayoutObject }) {
  const children = obj.children ?? [];
  return (
    <>
      {children.map(child => (
        <div
          key={child.id}
          class={`fm-object ${TYPE_CLASS[child.type] ?? 'fm-unknown'}`}
          style={{
            position: 'absolute',
            left:   child.x + 'px',
            top:    child.y + 'px',
            width:  child.width + 'px',
            height: child.height + 'px',
          }}
          title={child.fmName || child.type}
        >
          <span class="fm-obj-label">
            {child.type === 'field'
              ? (child.fieldRef?.split('::')[1] ?? child.fmName ?? '')
              : (child.displayText ?? '')}
          </span>
        </div>
      ))}
    </>
  );
}


function PortalContent({ obj }: { obj: LayoutObject }) {
  const cols = obj.children ?? [];
  return (
    <>
      <div class="fm-portal-header">
        {cols.map((c, i) => (
          <div key={i} class="fm-portal-col">{c.fieldRef?.split('::')[1] ?? c.displayText ?? ''}</div>
        ))}
      </div>
      <div class="fm-portal-row" style={{ opacity: 0.4 }}>
        {cols.map((_, i) => <div key={i} class="fm-portal-col">—</div>)}
      </div>
    </>
  );
}

function TabContent({ obj }: { obj: LayoutObject }) {
  const labels = obj.tabLabels ?? [];
  return (
    <div class="fm-tab-strip">
      {labels.map((l, i) => (
        <div key={i} class={`fm-tab-btn${i === 0 ? ' active' : ''}`}>{l || `Tab ${i + 1}`}</div>
      ))}
    </div>
  );
}

function SlideContent({ obj }: { obj: LayoutObject }) {
  const count = obj.slideCount ?? 0;
  return (
    <div class="fm-slide-dots">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} class={`fm-slide-dot${i === 0 ? ' active' : ''}`} />
      ))}
    </div>
  );
}
