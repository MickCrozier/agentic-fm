/**
 * TypeScript interfaces for the step catalog.
 * The catalog itself lives at agent/catalogs/step-catalog-en.json
 * and is the universal format consumed by all environments.
 */

export interface StepCatalogEntry {
  /** Step name as shown in FileMaker (e.g. "Go to Portal Row") */
  name: string;
  /** Numeric step ID from FileMaker (null if unknown) */
  id: number | null;
  /** Category derived from snippet_examples subdirectory */
  category: string;
  /** Relative path to snippet_examples file (e.g. "navigation/Go to Portal Row.xml") */
  snippetFile: string;
  /** True if the step has no child elements (emits <Step .../>) */
  selfClosing: boolean;
  /** Structured parameter definitions in XML child element order */
  params: StepParam[];
  /** Human-readable bracket format (null = not yet defined) */
  hrSignature: string | null;
  /** Monaco editor snippet template (null = no snippet) */
  monacoSnippet: string | null;
  /** Block pairing info for matched steps like If/End If */
  blockPair: StepBlockPair | null;
  /** Catalog entry status: auto-generated, human-reviewed, or complete */
  status: 'auto' | 'reviewed' | 'complete';
  /** Link to Claris help documentation */
  helpUrl: string | null;
}

export interface StepParam {
  /** XML element name (e.g. "SelectAll", "RowPageLocation", "Calculation") */
  xmlElement: string;
  /** Parameter type classification */
  type:
    | 'boolean'
    | 'enum'
    | 'calculation'
    | 'namedCalc'
    | 'field'
    | 'layout'
    | 'script'
    | 'table'
    | 'text'
    | 'name'
    | 'complex';
  /** HR label prefix (e.g. "Select") — null means positional */
  hrLabel: string | null;
  /** XML attribute name for boolean/enum (e.g. "state", "value") */
  xmlAttr?: string;
  /** Valid values for enum parameters */
  enumValues?: string[];
  /** HR enum labels mapped to XML state values (e.g. { "True": "Off", "False": "On" }) */
  hrEnumValues?: Record<string, string>;
  /** When true, the HR label is inverted from the XML attribute value */
  invertedHr?: boolean;
  /** Parent element name for namedCalc parameters */
  wrapperElement?: string;
  /** Whether this parameter is required */
  required: boolean;
  /** Default value from the snippet template */
  defaultValue?: string;
  /** Human-readable description of the parameter */
  description?: string;
}

export interface StepBlockPair {
  /** Role of this step in the block */
  role: 'open' | 'close' | 'middle';
  /** Partner step names */
  partners: string[];
}
