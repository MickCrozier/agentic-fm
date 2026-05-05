/** TypeScript types matching agent/CONTEXT.example.json schema */

/** Current expected context_version from the Context() custom function */
export const CONTEXT_VERSION_CURRENT = 2;

export interface FMContext {
  context_version?: number;
  solution?: string;
  task?: string;
  generated_at?: string;
  current_layout?: {
    name: string;
    id: number;
    base_to: string;
    base_to_id: number;
  };
  tables?: Record<string, FMTable>;
  relationships?: FMRelationship[];
  scripts?: Record<string, { id: number }>;
  layouts?: Record<string, { id: number; base_to: string }>;
  value_lists?: Record<string, { id: number; values: string[] }>;
  layout_objects?: unknown[];
  custom_functions?: Record<string, unknown>;
}

export interface FMTable {
  id: number;
  to: string;
  to_id: number;
  fields: Record<string, FMField>;
}

export interface FMField {
  id: number;
  type: string;
  auto_enter?: string;
  fieldtype?: string;
  calc?: string;
}

export interface FMRelationship {
  left_to: string;
  left_to_id: number;
  right_to: string;
  right_to_id: number;
  join_type: string;
  left_field: string;
  right_field: string;
  cascade_create: boolean;
  cascade_delete: boolean;
}
