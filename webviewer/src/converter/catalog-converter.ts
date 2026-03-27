/**
 * Generic HR-to-XML converter driven by the step catalog.
 *
 * Registers converters for all catalog steps that don't already have
 * hand-coded converters. Self-closing steps with no params get trivial
 * converters. Parameterized steps get a best-effort generic converter
 * that maps HR params to XML elements based on catalog definitions.
 */

import type { StepCatalogEntry, StepParam } from './catalog-types';
import type { ParsedLine } from './parser';
import type { IdResolver } from './id-resolver';
import { getHrToXmlConverter, registerHrToXml, stepSelfClose, stepOpen, cdata, escXml } from './step-registry';
import { extractLabel, unquote } from './parser';

/**
 * Register catalog-driven converters for all steps not yet handled
 * by hand-coded converters. Call this AFTER hand-coded step imports.
 */
export function registerCatalogConverters(catalog: StepCatalogEntry[]): void {
  for (const entry of catalog) {
    // Skip if a hand-coded converter already exists
    if (getHrToXmlConverter(entry.name)) continue;

    if (entry.selfClosing && entry.params.length === 0) {
      // Simple self-closing step (no parameters)
      registerHrToXml({
        stepNames: [entry.name],
        toXml(line: ParsedLine): string {
          return stepSelfClose(entry.name, !line.disabled);
        },
      });
    } else if (entry.params.length > 0) {
      // Parameterized step — generic conversion
      const capturedEntry = entry;
      registerHrToXml({
        stepNames: [entry.name],
        toXml(line: ParsedLine, resolver: IdResolver): string {
          return convertWithCatalog(capturedEntry, line, resolver);
        },
      });
    }
    // Steps with no params but not self-closing (e.g. steps with implicit
    // structure) get no converter — they'll fall through to the unknown handler.
  }
}

/**
 * Generic converter: map HR params to XML elements using catalog definitions.
 */
function convertWithCatalog(
  entry: StepCatalogEntry,
  line: ParsedLine,
  resolver: IdResolver,
): string {
  const xmlParts: string[] = [stepOpen(entry.name, !line.disabled)];

  // Track which HR params have been consumed
  let paramIdx = 0;

  for (const param of entry.params) {
    const hrValue = findParamValue(param, line.params, paramIdx);

    switch (param.type) {
      case 'boolean':
        xmlParts.push(emitBoolean(param, hrValue));
        break;
      case 'enum':
        xmlParts.push(emitEnum(param, hrValue));
        break;
      case 'calculation':
        xmlParts.push(`    <Calculation>${cdata(hrValue ?? '')}</Calculation>`);
        if (hrValue !== null) paramIdx++;
        break;
      case 'namedCalc':
        xmlParts.push(emitNamedCalc(param, hrValue));
        if (hrValue !== null) paramIdx++;
        break;
      case 'field': {
        const fieldRef = hrValue ?? '';
        const resolved = resolver.resolveField(fieldRef);
        xmlParts.push(
          `    <Field table="${escXml(resolved.table)}" id="${resolved.fieldId}" name="${escXml(resolved.fieldName)}"/>`,
        );
        if (hrValue !== null) paramIdx++;
        break;
      }
      case 'layout': {
        const layoutName = hrValue ? unquote(hrValue) : '';
        const resolved = resolver.resolveLayout(layoutName);
        xmlParts.push(`    <Layout id="${resolved.id}" name="${escXml(resolved.name)}"/>`);
        if (hrValue !== null) paramIdx++;
        break;
      }
      case 'script': {
        const scriptName = hrValue ? unquote(hrValue) : '';
        const resolved = resolver.resolveScript(scriptName);
        xmlParts.push(`    <Script id="${resolved.id}" name="${escXml(resolved.name)}"/>`);
        if (hrValue !== null) paramIdx++;
        break;
      }
      case 'text':
      case 'name':
        xmlParts.push(`    <${param.xmlElement}>${escXml(hrValue ?? '')}</${param.xmlElement}>`);
        if (hrValue !== null) paramIdx++;
        break;
      case 'complex':
        // Complex params can't be generically converted — skip
        break;
    }
  }

  xmlParts.push('  </Step>');
  return xmlParts.join('\n');
}

/**
 * Find the HR value for a catalog param.
 * If the param has an hrLabel, look for "Label: value" in the HR params.
 * Otherwise, use positional matching.
 */
function findParamValue(
  param: StepParam,
  hrParams: string[],
  positionalIdx: number,
): string | null {
  // Labeled match
  if (param.hrLabel) {
    for (const p of hrParams) {
      const val = extractLabel(p, param.hrLabel);
      if (val !== null) return val;
    }
  }

  // Positional match
  if (positionalIdx < hrParams.length) {
    return hrParams[positionalIdx].trim();
  }

  return null;
}

/** Emit a boolean XML element */
function emitBoolean(param: StepParam, hrValue: string | null): string {
  const xmlEl = param.xmlElement;
  let state = param.defaultValue ?? 'False';

  if (hrValue !== null) {
    const lower = hrValue.toLowerCase();
    // Determine the HR-to-XML truth mapping.
    // When invertedHr is true, the HR label is the opposite of the XML state:
    //   e.g. "With dialog: Off" → NoInteract state="True" (no interaction = dialog off)
    let hrMeansTrue: boolean;
    if (lower === 'on' || lower === 'true' || lower === 'yes') {
      hrMeansTrue = true;
    } else if (lower === 'off' || lower === 'false' || lower === 'no') {
      hrMeansTrue = false;
    } else {
      // Unrecognized value — try hrEnumValues mapping
      hrMeansTrue = state === 'True';
      if (param.hrEnumValues) {
        for (const [xmlState, hrLabel] of Object.entries(param.hrEnumValues)) {
          if (hrLabel.toLowerCase() === lower) {
            hrMeansTrue = xmlState === 'True';
            break;
          }
        }
      }
    }

    if (param.invertedHr) hrMeansTrue = !hrMeansTrue;
    state = hrMeansTrue ? 'True' : 'False';
  }

  return `    <${xmlEl} state="${state}"/>`;
}

/** Emit an enum XML element */
function emitEnum(param: StepParam, hrValue: string | null): string {
  const xmlEl = param.xmlElement;
  const value = hrValue ?? param.defaultValue ?? '';
  return `    <${xmlEl} value="${escXml(value)}"/>`;
}

/** Emit a named calculation (wrapper element containing Calculation) */
function emitNamedCalc(param: StepParam, hrValue: string | null): string {
  const wrapper = param.wrapperElement ?? param.xmlElement;
  return [
    `    <${wrapper}>`,
    `      <Calculation>${cdata(hrValue ?? '')}</Calculation>`,
    `    </${wrapper}>`,
  ].join('\n');
}
