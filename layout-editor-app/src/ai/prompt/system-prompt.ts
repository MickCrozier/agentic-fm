import type { LayoutState, LayoutObject } from '@/xml/import';

export function buildSystemPrompt(opts: {
  layoutName?: string;
  state?: LayoutState | null;
  customInstructions?: string;
}): string {
  const { layoutName, state, customInstructions } = opts;

  let prompt = `You are a FileMaker layout design assistant embedded in a web-based visual layout editor. You can both advise on layout design AND directly apply changes to the layout.

IMPORTANT: This is a web app — not FileMaker itself. Do not suggest FileMaker menu commands, keyboard shortcuts, or anything that requires interacting with the FileMaker application. All changes must be made through this editor's tools or via the layout-patch mechanism below.

FileMaker layouts are composed of objects (fields, text labels, buttons, portals, lines, rectangles, tab controls, slide panels, web viewers, popovers) placed on parts (Header, Body, Footer, Sub-summary, etc.).

## Applying layout changes

When the user asks you to make a change, respond conversationally then include a fenced \`\`\`layout-patch block with a JSON array of operations. The editor will detect and apply it automatically.

Supported operations:

\`\`\`layout-patch
[
  { "op": "move",   "id": "<objectId>", "x": 10, "y": 20 },
  { "op": "resize", "id": "<objectId>", "width": 200, "height": 30 },
  { "op": "update", "id": "<objectId>", "displayText": "New Label" },
  { "op": "style",  "id": "<objectId>", "themeClass": "button-default-bd", "fmStyles": { "backgroundColor": "#ff0000", "color": "#ffffff", "fontSize": "14px", "fontWeight": "bold", "textAlign": "center", "borderTopWidth": "1px", "borderTopColor": "#cccccc", "borderTopStyle": "solid" } },
  { "op": "delete", "id": "<objectId>" },
  { "op": "add", "object": { "type": "text", "x": 10, "y": 10, "width": 120, "height": 22, "displayText": "Hello" } }
]
\`\`\`

Object types for "add": field, text, button, rectangle, line.
Coordinates are in pixels from the layout top-left. Use the object IDs from the layout inventory below.

The "style" op accepts:
- \`themeClass\`: the FileMaker theme style class name (e.g. "button-default-bd", "field-control-bd")
- \`fmStyles\`: partial style overrides — valid keys: backgroundColor, color, fontSize, fontWeight, textAlign, verticalAlign (top/center/bottom), fontFamily, borderTopWidth/RightWidth/BottomWidth/LeftWidth, borderTopColor/RightColor/BottomColor/LeftColor, borderTopStyle/RightStyle/BottomStyle/LeftStyle, boxShadow. Use standard CSS values (e.g. "#rrggbb", "14px", "bold"). Only include keys you want to change.

Only emit a layout-patch block when you are actually making a change. For questions or analysis, respond with text only.`;

  if (state && (state.objects.length > 0 || state.parts.length > 0)) {
    prompt += `\n\n## Current layout${layoutName ? `: ${layoutName}` : ''}`;
    prompt += `\nCanvas width: ${state.width}px`;

    if (state.parts.length > 0) {
      prompt += `\nParts:`;
      let top = 0;
      for (const p of state.parts) {
        const h = p.bottom - top;
        prompt += `\n  - ${p.type} (${h}px)`;
        top = p.bottom;
      }
    }

    prompt += `\n\nObjects (${state.objects.length} total):`;
    const listed = summariseObjects(state.objects);
    prompt += '\n' + listed;

    if (state.popoverPanels.length > 0) {
      prompt += `\n\nPopover panels: ${state.popoverPanels.length}`;
    }
  }

  if (customInstructions?.trim()) {
    prompt += `\n\n## Developer instructions\n${customInstructions.trim()}`;
  }

  return prompt;
}

function summariseObjects(objects: LayoutObject[]): string {
  // Group by type for a compact but useful summary
  const byType: Record<string, LayoutObject[]> = {};
  for (const o of objects) {
    (byType[o.type] ??= []).push(o);
  }

  const lines: string[] = [];

  // Fields — list individually with field ref, position, and ID
  if (byType['field']) {
    lines.push(`Fields (${byType['field'].length}):`);
    for (const o of byType['field']) {
      const ref = o.fieldRef ?? o.fmName ?? '(unnamed)';
      lines.push(`  - [${o.id}] ${ref} at (${o.x}, ${o.y}) ${o.width}×${o.height}`);
    }
  }

  // Buttons — list with label and ID
  if (byType['button']) {
    lines.push(`Buttons (${byType['button'].length}):`);
    for (const o of byType['button']) {
      const label = o.displayText ?? o.fmName ?? '(unlabelled)';
      lines.push(`  - [${o.id}] "${label}" at (${o.x}, ${o.y}) ${o.width}×${o.height}`);
    }
  }

  // Text labels — list with text content and ID
  if (byType['text']) {
    lines.push(`Text labels (${byType['text'].length}):`);
    for (const o of byType['text']) {
      const txt = (o.displayText ?? o.fmName ?? '').slice(0, 40);
      lines.push(`  - [${o.id}] "${txt}" at (${o.x}, ${o.y}) ${o.width}×${o.height}`);
    }
  }

  // Portals — name, child count, and ID
  if (byType['portal']) {
    lines.push(`Portals (${byType['portal'].length}):`);
    for (const o of byType['portal']) {
      const cols = o.children?.length ?? 0;
      lines.push(`  - [${o.id}] ${o.fmName || '(unnamed)'} at (${o.x}, ${o.y}) ${o.width}×${o.height}, ${cols} columns`);
    }
  }

  // Other types with ID
  for (const type of ['tab-control', 'slide-control', 'popover-btn', 'group', 'rectangle', 'line', 'web-viewer']) {
    if (byType[type]?.length) {
      const ids = byType[type].map(o => `[${o.id}] (${o.x},${o.y}) ${o.width}×${o.height}`).join(', ');
      lines.push(`${type}: ${ids}`);
    }
  }

  return lines.join('\n');
}
