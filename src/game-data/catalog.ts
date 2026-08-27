import { sourceItems, successRates } from './catalog-data.js';
import { chineseItemNames } from './item-translations.js';
import { manufactureMaterialsByItem } from './manufacture-data.js';
import { manufactureUpgradeItemByItem } from './manufacture-upgrade-data.js';

export const GAME_DATA_VERSION = 'milkonomy-game-data-v1.20260309.1';
export const FORMULA_VERSION = 'milkonomy-enhance-direct-port-v2';

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
  manufactureMaterials?: ReadonlyArray<{ itemHrid: string; quantity: number }>;
  manufactureUpgradeItemHrid?: string;
  steps: ReadonlyArray<EnhancementStep>;
}

/** Tradable enhanceable items exported by Milkonomy from MWI game data. */
export const enhanceableItems: ReadonlyArray<EnhanceableItem> = sourceItems.map(item => ({
  itemHrid: item.itemHrid,
  name: chineseItemNames[item.itemHrid] ?? item.name,
  englishName: item.name,
  itemLevel: item.itemLevel,
  ...('protectionItemHrids' in item ? { protectionItemHrids: item.protectionItemHrids } : {}),
  ...(manufactureMaterialsByItem[item.itemHrid] ? { manufactureMaterials: manufactureMaterialsByItem[item.itemHrid] } : {}),
  ...(manufactureUpgradeItemByItem[item.itemHrid] ? { manufactureUpgradeItemHrid: manufactureUpgradeItemByItem[item.itemHrid] } : {}),
  steps: successRates.map((baseSuccessRate, index) => ({
    toLevel: index + 1,
    baseSuccessRate,
    experience: 1.4 * (index + 1) * (10 + item.itemLevel),
    materials: item.materials,
  })),
}));
