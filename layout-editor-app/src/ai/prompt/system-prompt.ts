import type { LayoutState, LayoutObject } from '@/xml/import';

export function buildSystemPrompt(opts: {
  layoutName?: string;
  state?: LayoutState | null;
  customInstructions?: string;
}): string {
  const { layoutName, state, customInstructions } = opts;

  let prompt = `You are a FileMaker layout design assistant embedded in a visual layout editor.

FileMaker layouts are composed of objects (fields, text labels, buttons, portals, lines, rectangles, tab controls, slide panels, web viewers, popovers) placed on parts (Header, Body, Footer, Sub-summary, etc.).

You can help with:
- Analysing the current layout structure and suggesting improvements
- Recommending object placement, sizing, and alignment
- Layout patterns for list views, detail views, card windows, portals
- Calculations for conditional formatting, tooltips, hide conditions
- Explaining how FM layout objects and their properties work

When you suggest a layout change, be specific: name the object, describe what to change and the new value. The developer applies changes in the canvas editor.`;

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

  // Fields — list individually with field ref and position
  if (byType['field']) {
    lines.push(`Fields (${byType['field'].length}):`);
    for (const o of byType['field']) {
      const ref = o.fieldRef ?? o.fmName ?? '(unnamed)';
      lines.push(`  - ${ref} at (${o.x}, ${o.y}) ${o.width}×${o.height}`);
    }
  }

  // Buttons — list with label
  if (byType['button']) {
    lines.push(`Buttons (${byType['button'].length}):`);
    for (const o of byType['button']) {
      const label = o.displayText ?? o.fmName ?? '(unlabelled)';
      lines.push(`  - "${label}" at (${o.x}, ${o.y}) ${o.width}×${o.height}`);
    }
  }

  // Text labels — list with text content
  if (byType['text']) {
    lines.push(`Text labels (${byType['text'].length}):`);
    for (const o of byType['text']) {
      const txt = (o.displayText ?? o.fmName ?? '').slice(0, 40);
      lines.push(`  - "${txt}" at (${o.x}, ${o.y})`);
    }
  }

  // Portals — name and child count
  if (byType['portal']) {
    lines.push(`Portals (${byType['portal'].length}):`);
    for (const o of byType['portal']) {
      const cols = o.children?.length ?? 0;
      lines.push(`  - ${o.fmName || '(unnamed)'} at (${o.x}, ${o.y}) ${o.width}×${o.height}, ${cols} columns`);
    }
  }

  // Containers — just counts for brevity
  for (const type of ['tab-control', 'slide-control', 'popover-btn', 'group', 'rectangle', 'line', 'web-viewer']) {
    if (byType[type]?.length) {
      lines.push(`${type}: ${byType[type].length}`);
    }
  }

  return lines.join('\n');
}
