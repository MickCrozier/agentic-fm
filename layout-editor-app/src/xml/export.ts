import type { LayoutObject, LayoutState } from './import';
import type { FMStyles } from './parseFMCSS';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FM_STYLE_PROPS: (keyof FMStyles)[] = [
  'backgroundColor', 'color',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'verticalAlign', 'boxShadow', 'borderRadius',
];

const STYLE_TO_CSS: Partial<Record<keyof FMStyles, string>> = {
  backgroundColor: 'background-color',
  color: 'color',
  borderTopColor: 'border-top-color',
  borderRightColor: 'border-right-color',
  borderBottomColor: 'border-bottom-color',
  borderLeftColor: 'border-left-color',
  borderTopWidth: 'border-top-width',
  borderRightWidth: 'border-right-width',
  borderBottomWidth: 'border-bottom-width',
  borderLeftWidth: 'border-left-width',
  borderTopStyle: 'border-top-style',
  borderRightStyle: 'border-right-style',
  borderBottomStyle: 'border-bottom-style',
  borderLeftStyle: 'border-left-style',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  textAlign: 'text-align',
  verticalAlign: '-fm-text-vertical-align',
  boxShadow: 'box-shadow',
  borderRadius: 'border-radius',
};

function localStylesCSS(styles: FMStyles | undefined): string {
  if (!styles) return '';
  const lines: string[] = [];
  for (const key of FM_STYLE_PROPS) {
    const val = styles[key];
    if (val === undefined) continue;
    const prop = STYLE_TO_CSS[key];
    if (prop) lines.push(`\t${prop}: ${val};`);
  }
  if (lines.length === 0) return '';
  return `self:normal .self\n{\n${lines.join('\n')}\n}\n`;
}

function stylesXML(obj: LayoutObject): string {
  const css = localStylesCSS(obj.localStyles);
  if (!css) return '';
  // Encode newlines and tabs as XML entities to match FM's format
  const encoded = css.replace(/\n/g, '&#10;').replace(/\t/g, '&#09;');
  const nameAttr = obj.themeClass ? ` name="" displayName="${esc(obj.themeClass)}"` : ' name="" displayName=""';
  return `<Styles><LocalCSS${nameAttr}>${encoded}</LocalCSS></Styles>`;
}

function extendedAttributes(): string {
  return `<ExtendedAttributes fontHeight="12" graphicFormat="5">
<NumFormat flags="2304" charStyle="0" negativeStyle="0" currencySymbol="$" thousandsSep="44" decimalPoint="46" negativeColor="#DD000000" decimalDigits="2" trueString="Yes" falseString="No"/>
<TimeFormat flags="143" charStyle="0" hourStyle="0" minsecStyle="1" separator="58" amString=" am" pmString=" pm" ampmString=""/>
<CharacterStyle mask="32695">
<Font-family codeSet="Roman" fontId="0" postScript="">Geneva</Font-family>
<Font-size>12</Font-size><Face>0</Face><Color>#000000</Color>
</CharacterStyle>
</ExtendedAttributes>`;
}

function textObj(text: string, isButton: boolean, obj?: LayoutObject): string {
  const flags = isButton ? '2' : '0';
  const escaped = text.replace(/]]>/g, ']]]]><![CDATA[>');
  const styles = obj ? stylesXML(obj) : '';
  return `<TextObj flags="${flags}">
${extendedAttributes()}${styles ? '\n' + styles : ''}
<CharacterStyleVector>
<Style><Data><![CDATA[${escaped}]]></Data><CharacterStyle mask="0"/></Style>
</CharacterStyleVector>
<ParagraphStyleVector>
<Style><Data></Data><ParagraphStyle mask="0"/></Style>
</ParagraphStyleVector>
</TextObj>`;
}

const CONTROL_STYLE_FM_TYPE: Record<string, string> = {
  'drop-down-list':     'Drop-down List',
  'drop-down-calendar': 'Drop-down Calendar',
  'pop-up-menu':        'Pop-up Menu',
  'checkbox-set':       'Checkbox Set',
  'radio-button-set':   'Radio Button Set',
};

const CONTROL_STYLE_DISPLAY_TYPE: Record<string, string> = {
  'drop-down-list':     '1',
  'drop-down-calendar': '3',
  'pop-up-menu':        '2',
  'checkbox-set':       '5',
  'radio-button-set':   '6',
};

function fieldObjXML(fieldRef: string, obj: LayoutObject): string {
  const parts = fieldRef.split('::');
  const table = parts.length === 2 ? parts[0] : '';
  const field = parts.length === 2 ? parts[1] : fieldRef;
  const displayType = obj.controlStyle ? (CONTROL_STYLE_DISPLAY_TYPE[obj.controlStyle] ?? '0') : '0';
  const styles = stylesXML(obj);
  return `<FieldObj numOfReps="1" flags="32" inputMode="0" keyboardType="1" displayType="${displayType}" quickFind="1" pictFormat="5">
<Name>${esc(fieldRef)}</Name>
${extendedAttributes()}${styles ? '\n' + styles : ''}
<DDRInfo><Field name="${esc(field)}" id="0" repetition="1" maxRepetition="1" table="${esc(table)}"/></DDRInfo>
</FieldObj>`;
}

function boundsXML(x: number, y: number, w: number, h: number): string {
  const t = y, l = x, b = y + h, r = x + w;
  return `<Bounds top="${t}.0000000" left="${l}.0000000" bottom="${b}.0000000" right="${r}.0000000"/>`;
}

function portalObjXML(obj: LayoutObject, startKey: number): { xml: string; nextKey: number } {
  const toName = obj.fmName || (obj.children?.[0]?.fieldRef?.split('::')?.[0] ?? '');
  const children = obj.children ?? [];
  const rowHeight = children.length > 0 ? (children[0].height ?? 22) : 22;
  const visibleRows = Math.max(1, Math.floor(obj.height / rowHeight));

  let key = startKey + 1;
  const childXMLs: string[] = [];
  for (const child of children) {
    if (!child.fieldRef) continue;
    const cb = boundsXML(child.x, child.y, child.width, child.height);
    const fmType = child.controlStyle ? (CONTROL_STYLE_FM_TYPE[child.controlStyle] ?? 'Field') : 'Field';
    childXMLs.push(`<Object type="${fmType}" key="${key++}" LabelKey="0" flags="0" rotation="0">
${cb}
${fieldObjXML(child.fieldRef, child)}
</Object>`);
  }

  const inner = `<PortalObj showScrollBar="1" scrollBarType="1" rows="${visibleRows}" rowHeight="${rowHeight}.0000000" showBorders="0" showHeader="0">
<TableOccurrenceReference id="0" name="${esc(toName)}"/>
<ObjectList>
${childXMLs.join('\n')}
</ObjectList>
</PortalObj>`;

  const bounds = boundsXML(obj.x, obj.y, obj.width, obj.height);
  const nameAttr = obj.fmName ? ` name="${esc(obj.fmName)}"` : '';
  const xml = `<Object type="Portal"${nameAttr} key="${startKey}" LabelKey="0" flags="0" rotation="0">
${bounds}
${inner}
</Object>`;

  return { xml, nextKey: key };
}

function objectToXML(obj: LayoutObject, key: number): { xml: string; nextKey: number } {
  if (obj.type === 'portal') {
    return portalObjXML(obj, key);
  }

  const bounds = boundsXML(obj.x, obj.y, obj.width, obj.height);
  let fmType: string;
  let inner: string;

  switch (obj.type) {
    case 'field':
      fmType = obj.controlStyle ? (CONTROL_STYLE_FM_TYPE[obj.controlStyle] ?? 'Field') : 'Field';
      inner  = fieldObjXML(obj.fieldRef ?? obj.displayText ?? '', obj);
      break;
    case 'button':
      fmType = 'Button';
      inner  = `${textObj(obj.displayText ?? '', true, obj)}
<ButtonObj buttonFlags="0" iconSize="16" displayType="0">
<Step enable="True" id="0" name=""/>
</ButtonObj>`;
      break;
    case 'rectangle':
      fmType = 'Rectangle';
      inner  = `<RectObj/>${stylesXML(obj) ? '\n' + stylesXML(obj) : ''}`;
      break;
    case 'line':
      fmType = 'Line';
      inner  = '<LineObj/>';
      break;
    default:
      fmType = 'Text';
      inner  = textObj(obj.displayText ?? '', false, obj);
  }

  const nameAttr = obj.fmName ? ` name="${esc(obj.fmName)}"` : '';
  return {
    xml: `<Object type="${fmType}"${nameAttr} key="${key}" LabelKey="0" flags="0" rotation="0">
${bounds}
${inner}
</Object>`,
    nextKey: key + 1,
  };
}

export function exportToXML(state: LayoutState): string {
  const objects = state.objects;
  if (objects.length === 0) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="LayoutObjectList">\n<Layout enclosingRectTop="0.0000000" enclosingRectLeft="0.0000000" enclosingRectBottom="0.0000000" enclosingRectRight="0.0000000">\n</Layout>\n</fmxmlsnippet>';
  }

  let minT = Infinity, minL = Infinity, maxB = 0, maxR = 0;
  const objXML: string[] = [];
  let key = 1;

  for (const obj of objects) {
    minT = Math.min(minT, obj.y);
    minL = Math.min(minL, obj.x);
    maxB = Math.max(maxB, obj.y + obj.height);
    maxR = Math.max(maxR, obj.x + obj.width);
    const result = objectToXML(obj, key);
    objXML.push(result.xml);
    key = result.nextKey;
  }

  const layout = `<Layout enclosingRectTop="${minT}.0000000" enclosingRectLeft="${minL}.0000000" enclosingRectBottom="${maxB}.0000000" enclosingRectRight="${maxR}.0000000">
${objXML.join('\n')}
</Layout>`;

  return `<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="LayoutObjectList">\n${layout}\n</fmxmlsnippet>`;
}
