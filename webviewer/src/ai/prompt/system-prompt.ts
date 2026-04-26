import type { FMContext } from '@/context/types';
import type { StepInfo } from '@/api/client';
import type { StepCatalogEntry } from '@/converter/catalog-types';

/** Hardcoded fallback — used only when the server returns empty (both files missing). */
const FALLBACK_BASE = `You are a FileMaker script developer assistant. You help write and edit FileMaker scripts in human-readable format.

Your output should be in the human-readable FileMaker script format, NOT in XML. The user's editor will convert your output to XML automatically.`;

/**
 * Build the system prompt for AI providers.
 *
 * Base instructions come from `agent/config/webviewer-system-prompt.md` (override)
 * or `agent/config/webviewer-system-prompt.example.md` (default), fetched by the
 * client and passed in as `opts.baseSystemPrompt`. The file may contain
 * `{{PROMPT_MARKER}}` placeholders which are interpolated at build time.
 *
 * Dynamic sections (catalog, context, conventions, knowledge) are appended
 * programmatically — they require runtime data and cannot live in a static file.
 */
export function buildSystemPrompt(opts: {
  context?: FMContext | null;
  steps?: StepInfo[];
  catalog?: StepCatalogEntry[];
  codingConventions?: string;
  knowledgeDocs?: string;
  promptMarker?: string;
  customInstructions?: string;
  baseSystemPrompt?: string;
}): string {
  const sections: string[] = [];

  // Base instructions from file (with placeholder interpolation)
  let base = opts.baseSystemPrompt || FALLBACK_BASE;
  if (opts.promptMarker) {
    base = base.replace(/\{\{PROMPT_MARKER\}\}/g, opts.promptMarker);
  }
  sections.push(base);

  sections.push(`Your output should be in the human-readable FileMaker script format, NOT in XML. The user's editor will convert your output to XML automatically.

Format rules:
- Each script step goes on its own line
- Parameters go inside square brackets: StepName [ param1 ; param2 ]
- Use # for comments: # This is a comment
- Control flow uses indentation:
  If [ condition ]
      Set Variable [ $x ; 1 ]
  Else
      Set Variable [ $x ; 2 ]
  End If
- Field references use Table::Field notation: Invoices::Total
- Variables use $ prefix (local) or $$ prefix (global): $invoiceId, $$USER
- Let variables use ~ prefix in calculations: ~lineTotal
- CRITICAL: All indentation inside calculations (Let, Case, List, etc.) MUST use hard tab characters, never spaces. This applies to any expression content inside square brackets.

The context has been injected, do not look for CONTEXT.json.`);

  // Custom instructions (developer-provided)
  if (opts.customInstructions) {
    sections.push(`## Developer Instructions\n\n${opts.customInstructions}`);
  }

  // Coding conventions
  if (opts.codingConventions) {
    sections.push(`## Coding Conventions\n\n${opts.codingConventions}`);
  }

  // Knowledge base docs
  if (opts.knowledgeDocs) {
    sections.push(`## FileMaker Knowledge Base\n\nThe following documents contain curated behavioral insights, gotchas, and practical patterns for FileMaker scripting. Apply these when relevant to the current task.\n\n${opts.knowledgeDocs}`);
  }

  // Available step types
  if (opts.steps && opts.steps.length > 0) {
    const stepList = opts.steps.map(s => s.name).join(', ');
    sections.push(`## Available Script Steps\n\n${stepList}`);
  }

  // Step reference from catalog (only steps with known HR signatures)
  if (opts.catalog && opts.catalog.length > 0) {
    const known = opts.catalog.filter(e => e.hrSignature !== null);
    if (known.length > 0) {
      const lines = known.map(e => `- ${e.name} ${e.hrSignature}`);
      sections.push(`## Script Step Reference\nUse EXACTLY these formats:\n${lines.join('\n')}`);
    }
  }

  // Context
  if (opts.context) {
    sections.push(`## Current Context\n\n${formatContext(opts.context)}`);
  }

  return sections.join('\n\n---\n\n');
}

function formatContext(ctx: FMContext): string {
  const parts: string[] = [];

  if (ctx.solution) parts.push(`Solution: ${ctx.solution}`);
  if (ctx.task) parts.push(`Task: ${ctx.task}`);

  if (ctx.current_layout) {
    parts.push(`Current Layout: "${ctx.current_layout.name}" (base TO: ${ctx.current_layout.base_to})`);
  }

  if (ctx.tables) {
    parts.push('### Tables & Fields');
    for (const [tName, tData] of Object.entries(ctx.tables)) {
      const fields = Object.entries(tData.fields)
        .map(([fName, fData]) => `  - ${fName} (${fData.type}, id:${fData.id})`)
        .join('\n');
      parts.push(`**${tName}** (TO: ${tData.to})\n${fields}`);
    }
  }

  if (ctx.relationships && ctx.relationships.length > 0) {
    parts.push('### Relationships');
    for (const rel of ctx.relationships) {
      parts.push(`- ${rel.left_to}::${rel.left_field} = ${rel.right_to}::${rel.right_field}`);
    }
  }

  if (ctx.scripts) {
    parts.push('### Available Scripts');
    for (const [name, data] of Object.entries(ctx.scripts)) {
      parts.push(`- "${name}" (id:${data.id})`);
    }
  }

  if (ctx.layouts) {
    parts.push('### Available Layouts');
    for (const [name, data] of Object.entries(ctx.layouts)) {
      parts.push(`- "${name}" (id:${data.id}, TO: ${data.base_to})`);
    }
  }

  if (ctx.value_lists) {
    parts.push('### Value Lists');
    for (const [name, data] of Object.entries(ctx.value_lists)) {
      parts.push(`- "${name}": ${data.values?.join(', ') ?? '(field-based)'}`);
    }
  }

  return parts.join('\n\n');
}
