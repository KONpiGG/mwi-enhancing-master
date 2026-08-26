import type { PresetGameData } from './preset.js';

export interface PresetOption { hrid: string; name: string; slot: string }
const equipmentRows: Array<[string, string, string, Array<['Success'|'Experience'|'Speed', number, number]>]> = [
  ['/items/cheese_enhancer','奶酪强化器','tool',[['Success',.006,.00012]]],['/items/verdant_enhancer','翠绿强化器','tool',[['Success',.009,.00018]]],['/items/azure_enhancer','蔚蓝强化器','tool',[['Success',.012,.00024]]],['/items/burble_enhancer','深紫强化器','tool',[['Success',.018,.00036]]],['/items/crimson_enhancer','绛红强化器','tool',[['Success',.024,.00048]]],['/items/rainbow_enhancer','彩虹强化器','tool',[['Success',.03,.0006]]],['/items/holy_enhancer','神圣强化器','tool',[['Success',.036,.00072]]],['/items/celestial_enhancer','星空强化器','tool',[['Success',.042,.00084],['Experience',.04,.0008]]],
  ...[['trainee', '实习',.01,.001],['basic','基础',.02,.002],['advanced','高级',.035,.0035],['expert','专家',.05,.005],['master','大师',.065,.0065],['grandmaster','宗师',.08,.008]].map(([id,name,b,bonus]) => [`/items/${id}_enhancing_charm`,`${name}强化护符`,'charm',[['Experience',b,bonus]]] as typeof equipmentRows[number]),
  ['/items/enchanted_gloves','附魔手套','hands',[['Speed',.1,.002]]],
  ['/items/fighter_necklace','战士项链','neck',[]],['/items/ranger_necklace','射手项链','neck',[]],['/items/wizard_necklace','巫师项链','neck',[]],['/items/necklace_of_efficiency','效率项链','neck',[]],['/items/necklace_of_speed','速度项链','neck',[['Speed',.04,.004]]],['/items/necklace_of_wisdom','经验项链','neck',[['Experience',.03,.003]]],['/items/philosophers_necklace','贤者项链','neck',[['Speed',.04,.004],['Experience',.03,.003]]],
  ...[['earrings_of_armor','护甲耳环'],['earrings_of_critical_strike','暴击耳环'],['earrings_of_essence_find','精华发现耳环'],['earrings_of_gathering','采集耳环'],['earrings_of_rare_find','稀有发现耳环'],['earrings_of_regeneration','恢复耳环'],['earrings_of_resistance','抗性耳环'],['philosophers_earrings','贤者耳环']].map(([id,name]) => [`/items/${id}`,name,'earrings',[]] as typeof equipmentRows[number]),
  ...[['ring_of_armor','护甲戒指'],['ring_of_critical_strike','暴击戒指'],['ring_of_essence_find','精华发现戒指'],['ring_of_gathering','采集戒指'],['ring_of_rare_find','稀有发现戒指'],['ring_of_regeneration','恢复戒指'],['ring_of_resistance','抗性戒指'],['philosophers_ring','贤者戒指']].map(([id,name]) => [`/items/${id}`,name,'ring',[]] as typeof equipmentRows[number]),
  ...[['small_pouch','小袋子'],['medium_pouch','中袋子'],['large_pouch','大袋子'],['giant_pouch','巨大袋子'],['gluttonous_pouch','贪食之袋'],['guzzling_pouch','暴饮之囊']].map(([id,name]) => [`/items/${id}`,name,'pouch',[]] as typeof equipmentRows[number])
];
export const presetOptions: PresetOption[] = equipmentRows.map(([hrid,name,slot]) => ({hrid,name,slot}));
export const presetGameData: PresetGameData = {
  equipment: Object.fromEntries(equipmentRows.map(([h,, , buffs]) => [h, buffs.map(([attribute,value,enhancementBonus]) => ({attribute,value,enhancementBonus}))])),
  consumables: { '/items/enhancing_tea': [{attribute:'Speed',value:.02}], '/items/super_enhancing_tea': [{attribute:'Speed',value:.04}], '/items/ultra_enhancing_tea': [{attribute:'Speed',value:.06}], '/items/blessed_tea': [{attribute:'Blessed',value:.01}], '/items/wisdom_tea': [{attribute:'Experience',value:.12}] },
  seals: {},
  communityBuffs: {
    '/community_buff_types/moo_card': [{attribute:'Experience',value:.05}],
    '/community_buff_types/experience': [{attribute:'Experience',value:.2,perEnhanceLevel:.005,levelMode:'base-plus'}],
    '/community_buff_types/enhancing_speed': [{attribute:'Speed',value:.2,perEnhanceLevel:.005,levelMode:'base-plus'}]
  },
  achievements: {
    '/achievement_tiers/beginner': [], '/achievement_tiers/novice': [{attribute:'Experience',value:.02}],
    '/achievement_tiers/adept': [], '/achievement_tiers/veteran': [], '/achievement_tiers/champion': [{attribute:'Success',value:.002}]
  },
  shrines: {}, enhancementLevelTotalBonusMultiplierTable: [0,1,2.1,3.3,4.6,6,7.5,9.1,10.8,12.6,14.5,16.7,19.2,22,25.1,28.5,32.2,36.2,40.5,45.1,50]
};
