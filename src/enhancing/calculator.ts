import { FORMULA_VERSION, GAME_DATA_VERSION, type EnhanceableItem } from '../game-data/catalog.js';
import type { MarketSnapshot } from '../market/types.js';
import type { EnhancingBuffs } from './preset.js';

export interface StrategyStep { level: number; successRate: number; normalUpRate: number; leapUpRate: number; failureRate: number; attempts: number; protections: number; experience: number; materialCost: number }
export interface EnhancementStrategyResult {
  protectLevel: number; protectionItemHrid: string | null; calculable: boolean; missingPrices: string[];
  expectedActions: number; expectedProtections: number; expectedTime: number; baseItemCost: number;
  materialCost: number; protectionCost: number; cashCost: number; grossRevenue: number; marketFee: number;
  netRevenue: number; expectedProfit: number; profitRate: number; totalExperience: number;
  netTrainingCost: number; costPerExperience: number; attemptVariance: number; visits: number[]; steps: StrategyStep[];
}
export interface ProtectionEvaluation { bestStrategy: EnhancementStrategyResult; allStrategies: EnhancementStrategyResult[] }
export interface RankingRow {
  id: string; itemHrid: string; itemName: string; fromLevel: number; toLevel: number; bestStrategy: EnhancementStrategyResult;
  allStrategies: EnhancementStrategyResult[]; expectedAttempts: number; expectedProtections: number; totalExperience: number;
  purchaseCost: number; materialCost: number; protectionCost: number; capitalRequired: number; grossSaleRevenue: number;
  marketFee: number; saleRevenue: number; profit: number; profitRate: number; netTrainingCost: number; costPerExperience: number;
  expectedTime: number; experiencePerHour: number; laborCost: number; attemptVariance: number;
  volume: number; spread: number; snapshotTimestamp: string; formulaVersion: string; gameDataVersion: string; risks: string[];
}
export interface StrategyInput { snapshot: MarketSnapshot; item: EnhanceableItem; originLevel?: number; targetLevel: number; protectLevel: number; buffs?: EnhancingBuffs; marketFeeRate?: number; actionSeconds?: number }

const key = (h: string, l = 0) => `${h}\0${l}`;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Fundamental-matrix solution of the Milkonomy enhancement state transitions. */
export function buildEnhancementTransitions(item: EnhanceableItem, buffs: EnhancingBuffs, targetLevel: number, protectLevel: number) {
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > item.steps.length) throw new RangeError('invalid target level');
  if (!Number.isInteger(protectLevel) || protectLevel < 1 || protectLevel > targetLevel) throw new RangeError('invalid protection level');
  const rates = item.steps.slice(0, targetLevel).map((step, level) => {
    const itemLevel = item.itemLevel ?? 0;
    const levelRatio = buffs.playerLevel >= itemLevel ? .0005 * (buffs.playerLevel - itemLevel) : itemLevel ? -.5 * (1 - buffs.playerLevel / itemLevel) : 0;
    const success = clamp(step.baseSuccessRate * (1 + levelRatio + buffs.success));
    const blessed = clamp(buffs.blessed);
    return { level, success, normalUp: success * (1 - blessed), leapUp: success * blessed, failure: 1 - success };
  });
  const q = Array.from({ length: targetLevel }, () => Array(targetLevel).fill(0));
  for (const r of rates) {
    const add = (destination: number, probability: number) => { if (destination < targetLevel) q[r.level]![destination]! += probability; };
    add(r.level + 1, r.normalUp); add(r.level + 2, r.leapUp);
    add(r.level >= protectLevel ? r.level - 1 : 0, r.failure);
  }
  return { q, rates };
}

function solveVisits(q: number[][], origin: number): number[] {
  const n = q.length;
  const a = Array.from({ length: n }, (_, row) => [...Array.from({ length: n }, (_, col) => (row === col ? 1 : 0) - q[col]![row]!), row === origin ? 1 : 0]);
  for (let col = 0; col < n; col++) {
    let pivot = col; for (let row = col + 1; row < n; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const divisor = a[col]![col]!; if (Math.abs(divisor) < 1e-14) throw new Error('enhancement transition matrix is singular');
    for (let j = col; j <= n; j++) a[col]![j]! /= divisor;
    for (let row = 0; row < n; row++) if (row !== col) { const factor = a[row]![col]!; for (let j = col; j <= n; j++) a[row]![j]! -= factor * a[col]![j]!; }
  }
  return a.map(row => row[n]!);
}

function absorptionTimeVariance(q: number[][], origin: number): number {
  const n = q.length;
  const solve = (right: number[]) => {
    const a = Array.from({length:n}, (_,i) => [...Array.from({length:n},(_,j)=>(i===j?1:0)-q[i]![j]!), right[i]!]);
    for (let col=0; col<n; col++) { let pivot=col; for(let row=col+1;row<n;row++) if(Math.abs(a[row]![col]!)>Math.abs(a[pivot]![col]!)) pivot=row; [a[col],a[pivot]]=[a[pivot]!,a[col]!]; const d=a[col]![col]!; for(let j=col;j<=n;j++) a[col]![j]!/=d; for(let row=0;row<n;row++) if(row!==col){const f=a[row]![col]!;for(let j=col;j<=n;j++)a[row]![j]!-=f*a[col]![j]!;} }
    return a.map(row=>row[n]!);
  };
  const mean=solve(Array(n).fill(1));
  const second=solve(mean.map((_,i)=>1+2*q[i]!.reduce((sum,p,j)=>sum+p*mean[j]!,0)));
  return Math.max(0, second[origin]!-mean[origin]!**2);
}

export function evaluateEnhancementStrategy(input: StrategyInput): EnhancementStrategyResult {
  const { snapshot, item, targetLevel, protectLevel } = input; const origin = input.originLevel ?? 0;
  if (origin < 0 || origin >= targetLevel) throw new RangeError('origin level must be below target');
  const buffs = input.buffs ?? { playerLevel: 0, success: 0, blessed: 0, experience: 0, speed: 0 };
  const { q, rates } = buildEnhancementTransitions(item, buffs, targetLevel, protectLevel);
  const visits = solveVisits(q, origin); const quotes = new Map(snapshot.quotes.map(qt => [key(qt.itemHrid, qt.enhancementLevel), qt]));
  const missing = new Set<string>(); const ask = (hrid: string, level = 0) => { if (hrid === '/items/coin') return 1; const value = quotes.get(key(hrid, level))?.ask; if (value == null) missing.add(`${hrid}@+${level}:ask`); return value ?? NaN; };
  const bid = (hrid: string, level = 0) => { const value = quotes.get(key(hrid, level))?.bid; if (value == null) missing.add(`${hrid}@+${level}:bid`); return value ?? NaN; };
  const protectionHrids = [...(item.protectionItemHrids ?? [item.itemHrid]), '/items/mirror_of_protection'];
  const protectionCandidates = protectionHrids.map(hrid => ({ hrid, price: quotes.get(key(hrid, 0))?.ask ?? NaN })).filter(x => Number.isFinite(x.price));
  const protection = protectionCandidates.reduce<{hrid: string; price: number} | null>((best, x) => !best || x.price < best.price ? x : best, null);
  const expectedProtections = rates.reduce((sum, r) => sum + visits[r.level]! * r.failure * (r.level >= protectLevel ? 1 : 0), 0);
  if (expectedProtections !== 0 && !protection) missing.add('protection-item:ask');
  const baseItemCost = ask(item.itemHrid, origin); let materialCost = 0; let totalExperience = 0;
  const steps = rates.map(r => {
    const attempts = visits[r.level]!; let cost = 0;
    for (const material of item.steps[r.level]!.materials) cost += attempts * material.quantity * ask(material.itemHrid);
    const experience = attempts * (r.success + .1 * r.failure) * (1.4 * (r.level + 1) * (10 + (item.itemLevel ?? 0))) * (1 + buffs.experience);
    materialCost += cost; totalExperience += experience;
    return { level: r.level, successRate: r.success, normalUpRate: r.normalUp, leapUpRate: r.leapUp, failureRate: r.failure, attempts, protections: attempts * r.failure * (r.level >= protectLevel ? 1 : 0), experience, materialCost: cost };
  });
  const protectionCost = expectedProtections * (protection?.price ?? NaN); if (expectedProtections === 0) { /* NaN-free no-protection strategy */ }
  const actualProtectionCost = expectedProtections === 0 ? 0 : protectionCost;
  const grossRevenue = bid(item.itemHrid, targetLevel); const marketFee = grossRevenue * (input.marketFeeRate ?? .05);
  const cashCost = baseItemCost + materialCost + actualProtectionCost; const netRevenue = grossRevenue - marketFee;
  const expectedProfit = netRevenue - cashCost; const expectedActions = visits.reduce((a, b) => a + b, 0); const calculable = missing.size === 0 && [cashCost, grossRevenue].every(Number.isFinite);
  return { protectLevel, protectionItemHrid: expectedProtections ? protection?.hrid ?? null : null, calculable, missingPrices: [...missing], expectedActions, expectedProtections,
    expectedTime: expectedActions * (input.actionSeconds ?? 0) / (1 + buffs.speed + Math.max(0, buffs.playerLevel - (item.itemLevel ?? 0)) * .01), baseItemCost, materialCost, protectionCost: actualProtectionCost, cashCost,
    grossRevenue, marketFee, netRevenue, expectedProfit, profitRate: expectedProfit / cashCost, totalExperience, netTrainingCost: cashCost - netRevenue,
    costPerExperience: (cashCost - netRevenue) / totalExperience, visits, steps, attemptVariance: absorptionTimeVariance(q, origin) };
}

export function evaluateProtectionStrategies(input: Omit<StrategyInput, 'protectLevel'>): ProtectionEvaluation | null {
  const allStrategies = Array.from({ length: input.targetLevel }, (_, i) => evaluateEnhancementStrategy({ ...input, protectLevel: i + 1 }));
  const valid = allStrategies.filter(x => x.calculable); if (!valid.length) return null;
  return { bestStrategy: valid.reduce((a, b) => b.cashCost < a.cashCost ? b : a), allStrategies };
}

/** Shared project set; profit and training views only sort/filter these rows differently. */
export function calculateRankings(snapshot: MarketSnapshot, items: readonly EnhanceableItem[], buffs: EnhancingBuffs | number, now = new Date(), marketFeeRate = .05, hourlyRate = 0, actionSeconds = 12): RankingRow[] {
  const resolved = typeof buffs === 'number' ? { playerLevel: buffs, success: 0, blessed: 0, experience: 0, speed: 0 } : buffs; const rows: RankingRow[] = [];
  for (const item of items) for (let originLevel = 0; originLevel < item.steps.length; originLevel++) for (let targetLevel = originLevel + 1; targetLevel <= item.steps.length; targetLevel++) {
    const buy = snapshot.quotes.find(q => q.itemHrid === item.itemHrid && q.enhancementLevel === originLevel); const sell = snapshot.quotes.find(q => q.itemHrid === item.itemHrid && q.enhancementLevel === targetLevel); if (buy?.ask == null || sell?.bid == null) continue;
    const evaluation = evaluateProtectionStrategies({ snapshot, item, originLevel, targetLevel, buffs: resolved, marketFeeRate, actionSeconds }); if (!evaluation) continue;
    const b = evaluation.bestStrategy;
    const midpoint = (buy.ask! + (buy.bid ?? buy.ask!)) / 2; const spread = midpoint ? (buy.ask! - (buy.bid ?? buy.ask!)) / midpoint : 0; const volume = Math.min(buy.hourlyVolume, sell.hourlyVolume); const risks: string[] = [];
    if (volume < 5) risks.push('低成交量'); if (spread > .2) risks.push('买卖价差较大'); if ((now.valueOf() - new Date(snapshot.timestamp).valueOf()) / 36e5 > 2) risks.push('市场数据陈旧');
    rows.push({ id: `${item.itemHrid}:${originLevel}:${targetLevel}`, itemHrid: item.itemHrid, itemName: item.name, fromLevel: originLevel, toLevel: targetLevel, bestStrategy: b, allStrategies: evaluation.allStrategies,
      expectedAttempts: b.expectedActions, expectedProtections: b.expectedProtections, totalExperience: b.totalExperience, purchaseCost: b.baseItemCost, materialCost: b.materialCost, protectionCost: b.protectionCost,
      capitalRequired: b.cashCost, grossSaleRevenue: b.grossRevenue, marketFee: b.marketFee, saleRevenue: b.netRevenue, profit: b.expectedProfit - hourlyRate*b.expectedTime/3600, profitRate: (b.expectedProfit-hourlyRate*b.expectedTime/3600)/(b.cashCost+hourlyRate*b.expectedTime/3600),
      expectedTime:b.expectedTime, experiencePerHour:b.expectedTime ? b.totalExperience*3600/b.expectedTime : 0, laborCost:hourlyRate*b.expectedTime/3600, attemptVariance:b.attemptVariance,
      netTrainingCost: b.netTrainingCost, costPerExperience: b.costPerExperience, volume, spread, snapshotTimestamp: snapshot.timestamp, formulaVersion: FORMULA_VERSION, gameDataVersion: GAME_DATA_VERSION, risks });
  }
  return rows;
}

export const rankProfitProjects = (rows: readonly RankingRow[]) => rows.filter(r => r.profit > 0).sort((a, b) => b.profit - a.profit);
export const rankTrainingProjects = (rows: readonly RankingRow[]) => [...rows].sort((a, b) => a.costPerExperience - b.costPerExperience);
