import type { LayoutObject, LayoutState } from './import';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LOCAL_CSS = 'self:normal .self&#10;{&#10;&#09;-fm-use-default-appearance: true;&#10;}&#10;';

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

function textObj(text: string, isButton: boolean): string {
  const flags = isButton ? '2' : '0';
  const escaped = text.replace(/]]>/g, ']]]]><![CDATA[>');
  return `<TextObj flags="${flags}">
${extendedAttributes()}
<Styles><LocalCSS>${LOCAL_CSS}</LocalCSS></Styles>
<CharacterStyleVector>
<Style><Data><![CDATA[${escaped}]]></Data><CharacterStyle mask="0"/></Style>
</CharacterStyleVector>
<ParagraphStyleVector>
<Style><Data></Data><ParagraphStyle mask="0"/></Style>
</ParagraphStyleVector>
</TextObj>`;
}

function fieldObjXML(fieldRef: string): string {
  const parts = fieldRef.split('::');
  const table = parts.length === 2 ? parts[0] : '';
  const field = parts.length === 2 ? parts[1] : fieldRef;
  return `<FieldObj numOfReps="1" flags="32" inputMode="0" keyboardType="1" displayType="0" quickFind="1" pictFormat="5">
<Name>${esc(fieldRef)}</Name>
${extendedAttributes()}
<Styles><LocalCSS>${LOCAL_CSS}</LocalCSS></Styles>
<DDRInfo><Field name="${esc(field)}" id="0" repetition="1" maxRepetition="1" table="${esc(table)}"/></DDRInfo>
</FieldObj>`;
}

function boundsXML(x: number, y: number, w: number, h: number): string {
  const t = y, l = x, b = y + h, r = x + w;
  return `<Bounds top="${t}.0000000" left="${l}.0000000" bottom="${b}.0000000" right="${r}.0000000"/>`;
}

function objectToXML(obj: LayoutObject, key: number): string {
  const bounds = boundsXML(obj.x, obj.y, obj.width, obj.height);
  let fmType: string;
  let inner: string;

  switch (obj.type) {
    case 'field':
      fmType = 'Field';
      inner  = fieldObjXML(obj.fieldRef ?? obj.displayText ?? '');
      break;
    case 'button':
      fmType = 'Button';
      inner  = `${textObj(obj.displayText ?? '', true)}
<ButtonObj buttonFlags="0" iconSize="16" displayType="0">
<Step enable="True" id="0" name=""/>
</ButtonObj>`;
      break;
    case 'rectangle':
      fmType = 'Rectangle';
      inner  = '<RectObj/>';
      break;
    case 'line':
      fmType = 'Line';
      inner  = '<LineObj/>';
      break;
    default:
      fmType = 'Text';
      inner  = textObj(obj.displayText ?? '', false);
  }

  const nameAttr = obj.fmName ? ` name="${esc(obj.fmName)}"` : '';
  return `<Object type="${fmType}"${nameAttr} key="${key}" LabelKey="0" flags="0" rotation="0">
${bounds}
${inner}
</Object>`;
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
    objXML.push(objectToXML(obj, key++));
  }

  const layout = `<Layout enclosingRectTop="${minT}.0000000" enclosingRectLeft="${minL}.0000000" enclosingRectBottom="${maxB}.0000000" enclosingRectRight="${maxR}.0000000">
${objXML.join('\n')}
</Layout>`;

  return `<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="LayoutObjectList">\n${layout}\n</fmxmlsnippet>`;
}
