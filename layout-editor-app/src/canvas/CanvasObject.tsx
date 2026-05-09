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
  container:      'fm-container',
  image:          'fm-image',
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
  container:     'container',
  'tab-control': 'tab_panel',
};

interface CanvasObjectProps {
  obj: LayoutObject;
  selected: boolean;
  previewState?: string;
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
  if (s.textAlign) {
    style.textAlign = s.textAlign;
    style.justifyContent = s.textAlign === 'center' ? 'center'
      : s.textAlign === 'right' ? 'flex-end'
      : 'flex-start';
  }
  if (s.boxShadow)       style.boxShadow = s.boxShadow;
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    const color = (s as Record<string, string>)[`border${side}Color`];
    const width = (s as Record<string, string>)[`border${side}Width`];
    const bstyle = (s as Record<string, string>)[`border${side}Style`];
    if (color)  style[`border${side}Color`] = color;
    if (width)  style[`border${side}Width`] = width;
    // Only set border style as inline when we have local values — otherwise let theme CSS control it
    if (bstyle) style[`border${side}Style`] = bstyle;
    else if (color || width) style[`border${side}Style`] = 'solid';
  }
  return style;
}

export function CanvasObject({ obj, selected, previewState, onMouseDown, onDblClick }: CanvasObjectProps) {
  const typeClass = TYPE_CLASS[obj.type] ?? 'fm-unknown';
  const s = obj.localStyles ?? {};
  const themeClass = buildThemeClasses(obj.type, obj.themeClass);
  const stateClass = selected && previewState && previewState !== 'normal' ? ` fm-state-${previewState}` : '';

  // Outer div: geometry + interaction only
  const outerStyle: Record<string, string> = {
    position: 'absolute',
    left:   obj.x + 'px',
    top:    obj.y + 'px',
    width:  obj.width + 'px',
    height: obj.height + 'px',
  };
  if (s.borderRadius) outerStyle.borderRadius = s.borderRadius;

  const selfStyle = buildSelfStyle(s);
  if (s.borderRadius) selfStyle.borderRadius = s.borderRadius;

  return (
    <div
      class={`fm-object ${typeClass}${themeClass}${stateClass}${selected ? ' selected' : ''}`}
      style={outerStyle}
      onMouseDown={(e) => onMouseDown(e as MouseEvent, obj)}
      onDblClick={(e) => { e.stopPropagation(); onDblClick(obj); }}
      title={obj.fmName || obj.type}
    >
      <div class="self" style={selfStyle}>
        {obj.type === 'button' || obj.type === 'popover-btn'
          ? <div class="inner_border" style={{ position: 'absolute', inset: '0', boxSizing: 'border-box', display: 'flex', overflow: 'hidden',
              justifyContent: selfStyle.justifyContent,
              alignItems: selfStyle.alignItems,
            }}>{renderContent(obj)}</div>
          : renderContent(obj)
        }
      </div>
    </div>
  );
}

function flexAlign(h: 'left'|'center'|'right', v: 'top'|'middle'|'bottom') {
  const jc = h === 'left' ? 'flex-start' : h === 'right' ? 'flex-end' : 'center';
  const ai = v === 'top'  ? 'flex-start' : v === 'bottom' ? 'flex-end'  : 'center';
  return { justifyContent: jc, alignItems: ai };
}

function renderButtonContent(obj: LayoutObject) {
  const { iconSVG, iconSize, iconPosition, iconAlignH = 'center', iconAlignV = 'middle', displayText } = obj;

  if (!iconSVG) {
    return <span class="fm-obj-label" style={labelStyle(obj)}>{displayText ?? ''}</span>;
  }

  const sizePx = (iconSize ?? 16) + 'px';
  const iconEl = (
    <span
      class="fm-btn-icon"
      style={{ width: sizePx, height: sizePx, flexShrink: '0' }}
      dangerouslySetInnerHTML={{ __html: iconSVG }}
    />
  );

  // Icon only (type 1) — position icon within button using h/v alignment
  if (!displayText || !iconPosition) {
    const { justifyContent, alignItems } = flexAlign(iconAlignH, iconAlignV);
    return (
      <div style={{ display: 'flex', width: '100%', height: '100%', justifyContent, alignItems }}>
        {iconEl}
      </div>
    );
  }

  const textEl = <span class="fm-obj-label" style={{ width: 'auto', textAlign: iconAlignH }}>{displayText}</span>;

  if (iconPosition === 'above' || iconPosition === 'below') {
    // Column: h→align-items, v→justify-content
    const jc = iconAlignV === 'top' ? 'flex-start' : iconAlignV === 'bottom' ? 'flex-end' : 'center';
    const ai = iconAlignH === 'left' ? 'flex-start' : iconAlignH === 'right' ? 'flex-end' : 'center';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', justifyContent: jc, alignItems: ai, gap: '2px' }}>
        {iconPosition === 'above' ? <>{iconEl}{textEl}</> : <>{textEl}{iconEl}</>}
      </div>
    );
  }

  // Row (left/right)
  const ai = iconAlignV === 'top' ? 'flex-start' : iconAlignV === 'bottom' ? 'flex-end' : 'center';
  if (iconAlignH === 'center') {
    // Center: group icon+text together and center as a unit
    const centeredTextEl = <span class="fm-obj-label" style={{ width: 'auto' }}>{displayText}</span>;
    return (
      <div style={{ display: 'flex', width: '100%', height: '100%', justifyContent: 'center', alignItems: ai, gap: '4px' }}>
        {iconPosition === 'right' ? <>{centeredTextEl}{iconEl}</> : <>{iconEl}{centeredTextEl}</>}
      </div>
    );
  }
  // Left or right: icon pinned to its end, text fills remaining space
  const rowTextEl = <span class="fm-obj-label" style={{ flex: '1', textAlign: iconAlignH }}>{displayText}</span>;
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: ai, gap: '4px' }}>
      {iconPosition === 'right' ? <>{rowTextEl}{iconEl}</> : <>{iconEl}{rowTextEl}</>}
    </div>
  );
}

function labelStyle(obj: LayoutObject): Record<string, string> {
  const style: Record<string, string> = {};
  if (obj.localStyles?.textAlign) style.textAlign = obj.localStyles.textAlign;
  return style;
}

function renderContent(obj: LayoutObject) {
  switch (obj.type) {
    case 'image': {
      if (!obj.imageData) return <span class="fm-obj-label" style={{ opacity: 0.4, fontSize: '9px' }}>Image</span>;
      const fmt = obj.imageFormat;
      const hPos = fmt?.hAlign ?? 'left';
      const vPos = fmt?.vAlign ?? 'top';
      let objectFit: string = 'none'; // crop
      if (fmt) {
        if (fmt.reduce && fmt.enlarge) objectFit = fmt.maintainProportions ? 'contain' : 'fill';
        else if (fmt.reduce)  objectFit = fmt.maintainProportions ? 'scale-down' : 'fill';
        else if (fmt.enlarge) objectFit = fmt.maintainProportions ? 'contain'    : 'fill';
      }
      return <img src={obj.imageData} style={{ width: '100%', height: '100%', display: 'block', objectFit: objectFit as any, objectPosition: `${hPos} ${vPos}` }} />;
    }
    case 'container':
      return (
        <div class="fm-container-placeholder">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ opacity: 0.4 }}>
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span class="fm-obj-label" style={{ fontSize: '9px', opacity: 0.5 }}>{obj.fieldRef?.split('::')[1] ?? obj.fmName ?? 'Container'}</span>
        </div>
      );
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
      return renderButtonContent(obj);
  }
}

function GroupContent({ obj }: { obj: LayoutObject }) {
  const children = obj.children ?? [];
  return (
    <>
      {children.map(child => {
        const childSelfStyle = buildSelfStyle(child.localStyles ?? {});
        const outerStyle: Record<string, string> = {
          position: 'absolute',
          left:   child.x + 'px',
          top:    child.y + 'px',
          width:  child.width + 'px',
          height: child.height + 'px',
        };
        if (child.localStyles?.borderRadius) {
          outerStyle.borderRadius = child.localStyles.borderRadius;
          childSelfStyle.borderRadius = child.localStyles.borderRadius;
        }
        return (
          <div
            key={child.id}
            class={`fm-object ${TYPE_CLASS[child.type] ?? 'fm-unknown'}${buildThemeClasses(child.type, child.themeClass)}`}
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
        const childSelfStyle = buildSelfStyle(child.localStyles ?? {});
        const outerStyle: Record<string, string> = {
          position: 'absolute',
          left:   child.x + 'px',
          top:    child.y + 'px',
          width:  child.width + 'px',
          height: child.height + 'px',
        };
        if (child.localStyles?.borderRadius) {
          outerStyle.borderRadius = child.localStyles.borderRadius;
          childSelfStyle.borderRadius = child.localStyles.borderRadius;
        }
        return (
          <div key={child.id} class={`fm-object ${TYPE_CLASS[child.type] ?? 'fm-unknown'}${buildThemeClasses(child.type, child.themeClass)}`} style={outerStyle} title={child.fmName || child.type}>
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
      {segments.flatMap((seg, i) => {
        const pct = barWidth > 0 ? (seg.width / barWidth) * 100 : (100 / segments.length);
        const segThemeClasses = [
          'fm-theme-button_bar_segment',
          barUUID ? `fm-theme-${barUUID}` : '',
        ].filter(Boolean).join(' ');
        const segStyle = buildSelfStyle(seg.localStyles ?? {});
        const posClass = (i === 0 ? ' first' : '') + (i === segments.length - 1 ? ' last' : '');
        const stateClass = i === 0 ? ' fm-state-checked' : '';
        const items = [];
        if (i > 0) {
          items.push(<div key={`div-${seg.id}`} class="button_bar_divider" />);
        }
        items.push(
          <div
            key={seg.id}
            class={`fm-btn-bar-seg${posClass}${stateClass} ${segThemeClasses}`}
            style={{ width: pct + '%', height: '100%', position: 'relative', overflow: 'hidden', boxSizing: 'border-box' }}
          >
            <div class="self" style={segStyle}>
              {renderButtonContent(seg)}
            </div>
          </div>
        );
        return items;
      })}
    </div>
  );
}

function SlideContent({ obj }: { obj: LayoutObject }) {
  const count = obj.slideCount ?? 0;
  const children = obj.children ?? [];
  return (
    <>
      {children.map(child => {
        const childSelfStyle = buildSelfStyle(child.localStyles ?? {});
        const outerStyle: Record<string, string> = {
          position: 'absolute',
          left:   child.x + 'px',
          top:    child.y + 'px',
          width:  child.width + 'px',
          height: child.height + 'px',
        };
        if (child.localStyles?.borderRadius) {
          outerStyle.borderRadius = child.localStyles.borderRadius;
          childSelfStyle.borderRadius = child.localStyles.borderRadius;
        }
        return (
          <div key={child.id} class={`fm-object ${TYPE_CLASS[child.type] ?? 'fm-unknown'}${buildThemeClasses(child.type, child.themeClass)}`} style={outerStyle} title={child.fmName || child.type}>
            <div class="self" style={childSelfStyle}>{renderContent(child)}</div>
          </div>
        );
      })}
      {count > 1 && (
        <div class="fm-slide-dots">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} class={`fm-slide-dot${i === 0 ? ' active' : ''}`} />
          ))}
        </div>
      )}
    </>
  );
}
