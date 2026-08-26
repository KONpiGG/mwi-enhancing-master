export interface EquipmentSelection { hrid?: string; enhanceLevel?: number }
export interface EnhancingPreset {
  id: string; name: string; color?: string;
  enhancing: { playerLevel: number; tool: EquipmentSelection; charm: EquipmentSelection; teas: string[] };
  specialEquipment: { hands: EquipmentSelection; body: EquipmentSelection; legs: EquipmentSelection; back: EquipmentSelection; neck: EquipmentSelection; earrings: EquipmentSelection; ring: EquipmentSelection; pouch: EquipmentSelection };
  seals: string[]; communityBuffs: Record<string, { hrid: string; level: number }>;
  achievementBuffs: Record<string, { enabled: boolean }>; shrines: Record<string, { level: number }>;
}
export type EnhancingAttribute = 'Success' | 'Blessed' | 'Experience' | 'Speed';
export interface BuffRecord { attribute: EnhancingAttribute; value: number; enhancementBonus?: number; perEnhanceLevel?: number; levelMode?: 'base-plus' }
export interface PresetGameData {
  equipment: Record<string, readonly BuffRecord[]>; consumables: Record<string, readonly BuffRecord[]>; seals: Record<string, readonly BuffRecord[]>;
  communityBuffs: Record<string, readonly BuffRecord[]>; achievements: Record<string, readonly BuffRecord[]>; shrines: Record<string, readonly BuffRecord[]>;
  enhancementLevelTotalBonusMultiplierTable?: readonly number[];
}
export interface EnhancingBuffs { playerLevel: number; success: number; blessed: number; experience: number; speed: number }

export function deriveEnhancingBuffs(preset: EnhancingPreset, data: PresetGameData): EnhancingBuffs {
  const result: EnhancingBuffs = { playerLevel: preset.enhancing.playerLevel, success: 0, blessed: 0, experience: 0, speed: 0 };
  const add = (records: readonly BuffRecord[] | undefined, level = 0, equipment = false) => { for (const buff of records ?? []) {
    const multiplier = equipment ? (data.enhancementLevelTotalBonusMultiplierTable?.[level] ?? 0) : level || 1;
    const scaled = buff.levelMode === 'base-plus' ? (level > 0 ? buff.value + (buff.perEnhanceLevel ?? 0) * (level - 1) : 0) : buff.value * multiplier + (buff.perEnhanceLevel ?? 0) * level;
    result[buff.attribute.toLowerCase() as 'success' | 'blessed' | 'experience' | 'speed'] += equipment ? buff.value + (buff.enhancementBonus ?? 0) * multiplier : scaled;
  } };
  const equipment = [preset.enhancing.tool, preset.enhancing.charm, ...Object.values(preset.specialEquipment)];
  for (const selection of equipment) if (selection.hrid) add(data.equipment[selection.hrid], selection.enhanceLevel ?? 0, true);
  for (const hrid of preset.enhancing.teas) add(data.consumables[hrid]); for (const hrid of preset.seals) add(data.seals[hrid]);
  for (const value of Object.values(preset.communityBuffs)) add(data.communityBuffs[value.hrid], value.level);
  for (const [hrid, value] of Object.entries(preset.achievementBuffs)) if (value.enabled) add(data.achievements[hrid]);
  for (const [hrid, value] of Object.entries(preset.shrines)) add(data.shrines[hrid], value.level);
  return result;
}

export function createPreset(name = '默认预设'): EnhancingPreset { return { id: crypto.randomUUID(), name, enhancing: { playerLevel: 100, tool: {}, charm: {}, teas: [] }, specialEquipment: { hands: {}, body: {}, legs: {}, back: {}, neck: {}, earrings: {}, ring: {}, pouch: {} }, seals: [], communityBuffs: {}, achievementBuffs: {}, shrines: {} }; }
export const exportPreset = (preset: EnhancingPreset) => JSON.stringify(preset, null, 2);
export function importPreset(json: string): EnhancingPreset { const value = JSON.parse(json) as EnhancingPreset; if (!value.id || !value.name || !value.enhancing || !value.specialEquipment) throw new Error('invalid enhancing preset'); return value; }
