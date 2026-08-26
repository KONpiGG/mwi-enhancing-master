import { sourceItems, successRates } from './generated-catalog.js';
import { chineseItemNames } from './item-translations.js';

export const GAME_DATA_VERSION = 'milkonomy-game-data-v1.20260309.0';
export const FORMULA_VERSION = 'milkonomy-markov-v1-febe90f';

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
  itemLevel?: number;
  protectionItemHrids?: ReadonlyArray<string>;
  steps: ReadonlyArray<EnhancementStep>;
}

/** Tradable enhanceable items exported by Milkonomy from MWI game data. */
export const enhanceableItems: ReadonlyArray<EnhanceableItem> = sourceItems.map(item => ({
  itemHrid: item.itemHrid,
  name: chineseItemNames[item.itemHrid] ?? item.name,
  englishName: item.name,
  itemLevel: item.itemLevel,
  steps: successRates.map((baseSuccessRate, index) => ({
    toLevel: index + 1,
    baseSuccessRate,
    experience: 1.4 * (index + 1) * (10 + item.itemLevel),
    materials: item.materials,
  })),
}));
