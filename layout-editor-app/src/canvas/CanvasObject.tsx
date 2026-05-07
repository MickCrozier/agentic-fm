import { useState } from 'preact/hooks';
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
  'button-bar':   'fm-button-bar',
  'popover-btn':  'fm-popover-btn',
  'popover-panel':'fm-popover-panel',
  unknown:        'fm-unknown',
};

// FM editor type → base theme CSS class name (provides type-level defaults)
const TYPE_THEME_BASE: Record<string, string> = {
  field:         'edit_box',
  text:          'text_box',
  button:        'button',
  'button-bar':  'button_bar',
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

function buildThemeClasses(type: string, themeClass: string | undefined): string {
  const baseTheme = TYPE_THEME_BASE[type];
  const classes = [
    baseTheme ? `fm-theme-${baseTheme}` : '',
    themeClass && themeClass !== baseTheme ? `fm-theme-${themeClass}` : '',
  ].filter(Boolean).join(' ');
  return classes ? ` ${classes}` : '';
}

function buildSelfStyle(s: ReturnType<typeof import('@/xml/parseFMCSS').parseFMCSS>): Record<string, string> {
  const style: Record<string, string> = {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };
  if (s.verticalAlign) {
    style.alignItems = s.verticalAlign === 'center' ? 'center'
      : s.verticalAlign === 'bottom' ? 'flex-end'
      : 'flex-start';
  }
  if (s.backgroundColor) style.backgroundColor = s.backgroundColor;
  if (s.color)           style.color = s.color;
  if (s.fontFamily)      style.fontFamily = s.fontFamily;
  if (s.fontSize)        style.fontSize = s.fontSize;
  if (s.fontWeight)      style.fontWeight = s.fontWeight;
  if (s.textAlign)       style.textAlign = s.textAlign;
  if (s.boxShadow)       style.boxShadow = s.boxShadow;
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    const color = (s as Record<string, string>)[`border${side}Color`];
    const width = (s as Record<string, string>)[`border${side}Width`];
    const bstyle = (s as Record<string, string>)[`border${side}Style`];
    if (color)  style[`border${side}Color`] = color;
    if (width)  style[`border${side}Width`] = width;
    // Default to solid when color or width is present but style is absent
    style[`border${side}Style`] = bstyle || ((color || width) ? 'solid' : 'none');
  }
  return style;
}

export function CanvasObject({ obj, selected, onMouseDown, onDblClick }: CanvasObjectProps) {
  const typeClass = TYPE_CLASS[obj.type] ?? 'fm-unknown';
  const s = obj.fmStyles ?? {};
  const themeClass = buildThemeClasses(obj.type, obj.themeClass);

  // Outer div: geometry + interaction only
  const outerStyle: Record<string, string> = {
    position: 'absolute',
    left:   obj.x + 'px',
    top:    obj.y + 'px',
    width:  obj.width + 'px',
    height: obj.height + 'px',
  };
  if (obj.cornerRadius) outerStyle.borderRadius = obj.cornerRadius + 'px';

  const selfStyle = buildSelfStyle(s);
  if (obj.cornerRadius) selfStyle.borderRadius = obj.cornerRadius + 'px';

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
    case 'button-bar':
      return <ButtonBarContent obj={obj} />;
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
      {children.map(child => {
        const childSelfStyle = buildSelfStyle(child.fmStyles ?? {});
        if (child.cornerRadius) {
          childSelfStyle.borderRadius = child.cornerRadius + 'px';
        }
        const outerStyle: Record<string, string> = {
          position: 'absolute',
          left:   child.x + 'px',
          top:    child.y + 'px',
          width:  child.width + 'px',
          height: child.height + 'px',
        };
        if (child.cornerRadius) outerStyle.borderRadius = child.cornerRadius + 'px';
        return (
          <div
            key={child.id}
            class={`fm-object ${TYPE_CLASS[child.type] ?? 'fm-unknown'}`}
            style={outerStyle}
            title={child.fmName || child.type}
          >
            <div class="self" style={childSelfStyle}>
              {renderContent(child)}
            </div>
          </div>
        );
      })}
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
  const [activeTab, setActiveTab] = useState(0);
  const panels = obj.tabPanels ?? (obj.tabLabels ?? []).map(label => ({ label, children: [] }));
  const stripHeight = obj.tabStripHeight ?? 24;
  const activePanel = panels[activeTab];

  return (
    <>
      <div class="fm-tab-strip" style={{ height: stripHeight + 'px', position: 'absolute', top: 0, left: 0, right: 0 }}>
        {panels.map((panel, i) => (
          <div
            key={i}
            class={`fm-tab-btn${i === activeTab ? ' active' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setActiveTab(i); }}
          >
            {panel.label || `Tab ${i + 1}`}
          </div>
        ))}
      </div>
      {activePanel?.children.map(child => {
        const childSelfStyle = buildSelfStyle(child.fmStyles ?? {});
        if (child.cornerRadius) childSelfStyle.borderRadius = child.cornerRadius + 'px';
        const outerStyle: Record<string, string> = {
          position: 'absolute',
          left:   child.x + 'px',
          top:    child.y + 'px',
          width:  child.width + 'px',
          height: child.height + 'px',
        };
        if (child.cornerRadius) outerStyle.borderRadius = child.cornerRadius + 'px';
        return (
          <div key={child.id} class={`fm-object ${TYPE_CLASS[child.type] ?? 'fm-unknown'}`} style={outerStyle} title={child.fmName || child.type}>
            <div class="self" style={childSelfStyle}>{renderContent(child)}</div>
          </div>
        );
      })}
    </>
  );
}

function ButtonBarContent({ obj }: { obj: LayoutObject }) {
  const segments = obj.children ?? [];
  const barWidth = obj.width;
  // The parent bar's UUID is the key: theme CSS uses button_bar_segment.FM-UUID
  // so segments must carry the bar's themeClass, not their own (which is just 'button')
  const barUUID = obj.themeClass;
  return (
    <div class="fm-btn-bar-segments">
      {segments.map((seg, i) => {
        const pct = barWidth > 0 ? (seg.width / barWidth) * 100 : (100 / segments.length);
        const segThemeClasses = [
          'fm-theme-button_bar_segment',
          barUUID ? `fm-theme-${barUUID}` : '',
        ].filter(Boolean).join(' ');
        const segStyle = buildSelfStyle(seg.fmStyles ?? {});
        const posClass = (i === 0 ? ' first' : '') + (i === segments.length - 1 ? ' last' : '');
        return (
          <div
            key={seg.id}
            class={`fm-btn-bar-seg${posClass} ${segThemeClasses}`}
            style={{ width: pct + '%', height: '100%', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' }}
          >
            <div class="self" style={segStyle}>
              <span class="fm-obj-label">{seg.displayText ?? ''}</span>
            </div>
          </div>
        );
      })}
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
