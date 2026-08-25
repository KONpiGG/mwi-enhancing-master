/**
 * A deliberately data-only module.  Updating game data must not silently change
 * the calculator implementation in ../enhancing/calculator.ts.
 */
export const GAME_DATA_VERSION = 'catalog-withdrawn-2026-08-25';
export const FORMULA_VERSION = 'backward-recurrence-v2';

export interface EnhancementStep {
  toLevel: number;
  baseSuccessRate: number;
  experience: number;
  materials: ReadonlyArray<{ itemHrid: string; quantity: number }>;
}

export interface EnhanceableItem {
  itemHrid: string;
  name: string;
  englishName?: string;
  steps: ReadonlyArray<EnhancementStep>;
}

// The former two-entry catalog was fabricated and could produce financially
// dangerous output. Keep production empty until an attributable official
// export is checked in; tests inject deterministic fixtures instead.
export const enhanceableItems: ReadonlyArray<EnhanceableItem> = [];
