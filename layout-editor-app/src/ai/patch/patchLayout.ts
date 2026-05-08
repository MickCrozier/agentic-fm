import type { LayoutState, LayoutObject } from '@/xml/import';
import type { FMStyles } from '@/xml/parseFMCSS';

export type LayoutOp =
  | { op: 'move';       id: string; x: number; y: number }
  | { op: 'resize';     id: string; width: number; height: number }
  | { op: 'update';     id: string; displayText?: string; fieldRef?: string; fmName?: string }
  | { op: 'style';      id: string; themeClass?: string; localStyles?: Partial<FMStyles> }
  | { op: 'delete';     id: string }
  | { op: 'add';        object: Partial<LayoutObject> & { type: string; x: number; y: number; width: number; height: number } };

function patchObject(obj: LayoutObject, op: LayoutOp): LayoutObject {
  if (op.op === 'move') {
    return { ...obj, x: op.x, y: op.y, bounds: { ...obj.bounds, top: op.y, left: op.x, bottom: op.y + obj.height, right: op.x + obj.width } };
  }
  if (op.op === 'resize') {
    return { ...obj, width: op.width, height: op.height, bounds: { ...obj.bounds, bottom: obj.y + op.height, right: obj.x + op.width } };
  }
  if (op.op === 'update') {
    return {
      ...obj,
      ...(op.displayText !== undefined ? { displayText: op.displayText } : {}),
      ...(op.fieldRef    !== undefined ? { fieldRef:    op.fieldRef    } : {}),
      ...(op.fmName      !== undefined ? { fmName:      op.fmName      } : {}),
    };
  }
  if (op.op === 'style') {
    return {
      ...obj,
      ...(op.themeClass !== undefined ? { themeClass: op.themeClass } : {}),
      ...(op.localStyles   !== undefined ? { localStyles: { ...obj.localStyles, ...op.localStyles } } : {}),
    };
  }
  return obj;
}

export function applyPatch(state: LayoutState, ops: LayoutOp[]): LayoutState {
  let next = state;

  for (const op of ops) {
    if (op.op === 'add') {
      const newObj: LayoutObject = {
        id: 'ai-' + Math.random().toString(36).slice(2, 8),
        fmId: '0', fmName: op.object.fmName ?? '',
        type: op.object.type as LayoutObject['type'],
        x: op.object.x, y: op.object.y,
        width: op.object.width, height: op.object.height,
        bounds: { top: op.object.y, left: op.object.x, bottom: op.object.y + op.object.height, right: op.object.x + op.object.width },
        displayText: op.object.displayText,
        fieldRef: op.object.fieldRef,
      };
      next = { ...next, objects: [...next.objects, newObj] };
      continue;
    }

    if (op.op === 'delete') {
      next = { ...next, objects: next.objects.filter(o => o.id !== op.id) };
      continue;
    }

    next = {
      ...next,
      objects: next.objects.map(o => o.id === op.id ? patchObject(o, op) : o),
    };
  }

  return next;
}

/** Extract layout-patch JSON blocks from streamed assistant text */
export function extractPatches(text: string): LayoutOp[] | null {
  const match = text.match(/```layout-patch\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const ops = JSON.parse(match[1].trim());
    if (Array.isArray(ops)) return ops as LayoutOp[];
  } catch { /* malformed */ }
  return null;
}
