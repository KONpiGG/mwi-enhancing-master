import type { PresetGameData } from './preset.js';

export interface PresetOption { hrid: string; name: string; slot: string }
const equipmentRows: Array<[string, string, string, Array<['Success'|'Experience'|'Speed', number, number]>]> = [
  ['/items/cheese_enhancer','奶酪强化器','tool',[['Success',.006,.00012]]],['/items/verdant_enhancer','翠绿强化器','tool',[['Success',.009,.00018]]],['/items/azure_enhancer','蔚蓝强化器','tool',[['Success',.012,.00024]]],['/items/burble_enhancer','深紫强化器','tool',[['Success',.018,.00036]]],['/items/crimson_enhancer','绛红强化器','tool',[['Success',.024,.00048]]],['/items/rainbow_enhancer','彩虹强化器','tool',[['Success',.03,.0006]]],['/items/holy_enhancer','神圣强化器','tool',[['Success',.036,.00072]]],['/items/celestial_enhancer','星空强化器','tool',[['Success',.042,.00084],['Experience',.04,.0008]]],
  ...[['trainee', '实习',.01,.001],['basic','基础',.02,.002],['advanced','高级',.035,.0035],['expert','专家',.05,.005],['master','大师',.065,.0065],['grandmaster','宗师',.08,.008]].map(([id,name,b,bonus]) => [`/items/${id}_enhancing_charm`,`${name}强化护符`,'charm',[['Experience',b,bonus]]] as typeof equipmentRows[number]),
  ['/items/enchanted_gloves','附魔手套','hands',[['Speed',.1,.002]]],['/items/enhancers_top','强化师上衣','body',[['Speed',.1,.002]]],['/items/enhancers_bottoms','强化师下装','legs',[['Speed',.1,.002],['Experience',.04,.0008]]],['/items/chance_cape','机遇披风','back',[['Speed',.05,.005],['Experience',.03,.003]]],['/items/chance_cape_refined','精制机遇披风','back',[['Speed',.058,.0058],['Experience',.0348,.00348]]],['/items/necklace_of_speed','速度项链','neck',[['Speed',.04,.004]]],['/items/necklace_of_wisdom','经验项链','neck',[['Experience',.03,.003]]],['/items/philosophers_necklace','贤者项链','neck',[['Speed',.04,.004],['Experience',.03,.003]]]
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
