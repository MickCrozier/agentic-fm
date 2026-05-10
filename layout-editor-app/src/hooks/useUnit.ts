import { useState } from 'preact/hooks';
import type { MeasureUnit } from '@/utils/units';

const STORAGE_KEY = 'fm-layout-unit';

function loadUnit(): MeasureUnit {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'pt' || v === 'cm' || v === 'in') return v;
  } catch {}
  return 'pt';
}

export function useUnit() {
  const [unit, setUnitState] = useState<MeasureUnit>(loadUnit);

  const setUnit = (u: MeasureUnit) => {
    try { localStorage.setItem(STORAGE_KEY, u); } catch {}
    setUnitState(u);
  };

  return { unit, setUnit };
}
