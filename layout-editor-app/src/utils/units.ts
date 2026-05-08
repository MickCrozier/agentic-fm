export type MeasureUnit = 'pt' | 'cm' | 'in';

export const UNIT_LABELS: { value: MeasureUnit; label: string }[] = [
  { value: 'pt', label: 'pt' },
  { value: 'cm', label: 'cm' },
  { value: 'in', label: 'in' },
];

// FM internal coords are points (72pt = 1 inch). px is treated as 1:1 with pt.
export function formatMeasure(ptValue: number, unit: MeasureUnit): string {
  switch (unit) {
    case 'pt':
      return `${Math.round(ptValue)}pt`;
    case 'cm':
      return `${(ptValue * 0.035278).toFixed(2)}cm`;
    case 'in':
      return `${(ptValue / 72).toFixed(3)}"`;
  }
}
