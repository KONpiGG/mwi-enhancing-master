import { FORMULA_VERSION, GAME_DATA_VERSION, type EnhanceableItem } from '../game-data/catalog.js';
import type { MarketSnapshot } from '../market/types.js';
import type { EnhancingBuffs } from './preset.js';

export interface MaterialPurchase { itemHrid: string; quantity: number }
export interface StrategyStep { level: number; successRate: number; normalUpRate: number; leapUpRate: number; failureRate: number; attempts: number; protections: number; experience: number; materialCost: number }
export interface EnhancementStrategyResult {
  protectLevel: number; protectionItemHrid: string | null; calculable: boolean; missingPrices: string[];
  expectedActions: number; expectedProtections: number; expectedTime: number; baseItemCost: number;
  materialCost: number; protectionCost: number; cashCost: number; grossRevenue: number; marketFee: number;
  netRevenue: number; expectedProfit: number; profitRate: number; totalExperience: number;
  netTrainingCost: number; costPerExperience: number; attemptVariance: number; visits: number[]; steps: StrategyStep[]; materialPurchases: MaterialPurchase[];
  baseItemSource: 'market' | 'manufacture'; manufactureCost: number;
}
export interface ProtectionEvaluation { bestStrategy: EnhancementStrategyResult; allStrategies: EnhancementStrategyResult[] }
export interface RankingRow {
  id: string; itemHrid: string; itemName: string; fromLevel: number; toLevel: number; bestStrategy: EnhancementStrategyResult;
  allStrategies: EnhancementStrategyResult[]; expectedAttempts: number; expectedProtections: number; totalExperience: number;
  purchaseCost: number; materialCost: number; protectionCost: number; capitalRequired: number; grossSaleRevenue: number;
  marketFee: number; saleRevenue: number; profit: number; profitRate: number; netTrainingCost: number; costPerExperience: number;
  expectedTime: number; experiencePerHour: number | null; experiencePerGold: number | null; experienceEfficiency: number | null; hourlyProfit: number | null; attemptVariance: number;
  recent72hVolume: number | null; historyVolume?: number; activeBuyVolume7d?: number; activeSellVolume7d?: number; historyWindowDays?: 7; averageDailyVolume7d?: number; volume: number; spread: number; snapshotTimestamp: string; formulaVersion: string; gameDataVersion: string; risks: string[];
  expectedPrice?: number; liquidityGrade?: 'S' | 'A' | 'B' | 'C' | 'D'; expectedSaleWaitHours?: number | null;
  marketListingPrice: number | null; marketSellingPrice: number | null;
  totalCost: number; lossProbability: number; profitP10: number; profitP50: number; profitP90: number; downsideLossRate: number; riskScore: number; riskLevel: string; simulationRuns: number;
}
export interface StrategyInput { snapshot: MarketSnapshot; item: EnhanceableItem; originLevel?: number; targetLevel: number; protectLevel: number; buffs?: EnhancingBuffs; marketFeeRate?: number; actionSeconds?: number; manufactureBase?: boolean }

const key = (h: string, l = 0) => `${h}\0${l}`;
// Risk is secondary metadata, while expected profit/experience is solved exactly.
// Keeping this bounded makes it possible to evaluate the entire quoted market
// instead of spending most of the request on Monte Carlo samples.
const matrixCache = new Map<string, { visitsByOrigin: number[][]; varianceByOrigin: number[] }>();
const quoteIndexes = new WeakMap<MarketSnapshot, Map<string, MarketSnapshot['quotes'][number]>>();

function quoteIndex(snapshot: MarketSnapshot) {
  let index = quoteIndexes.get(snapshot);
  if (!index) {
    index = new Map(snapshot.quotes.map(quote => [key(quote.itemHrid, quote.enhancementLevel), quote]));
    quoteIndexes.set(snapshot, index);
  }
  return index;
}

/**
 * Direct port of Milkonomy's EnhanceCalculator rate methods and enhancelate
 * transition construction. Keep the seemingly asymmetric Math.min: upstream
 * caps levelUpRate, but does not independently clamp success, blessing, leap,
 * or failure.
 *
 * Source: Milkonomy-main_ref/src/calculator/enhance.ts
 * Player-level ratio source: Milkonomy-main_ref/src/common/apis/player/index.ts
 */
export function buildEnhancementTransitions(item: EnhanceableItem, buffs: EnhancingBuffs, targetLevel: number, protectLevel: number) {
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > item.steps.length) throw new RangeError('invalid target level');
  if (!Number.isInteger(protectLevel) || protectLevel < 1 || protectLevel > targetLevel) throw new RangeError('invalid protection level');
  const rates = item.steps.slice(0, targetLevel).map((step, level) => {
    const itemLevel = item.itemLevel ?? 0;
    const levelRatio = buffs.playerLevel >= itemLevel ? .0005 * (buffs.playerLevel - itemLevel) : itemLevel ? -.5 * (1 - buffs.playerLevel / itemLevel) : 0;
    const success = step.baseSuccessRate * (1 + levelRatio + buffs.success);
    return {
      level,
      success,
      normalUp: Math.min(1, success * (1 - buffs.blessed)),
      leapUp: success * buffs.blessed,
      failure: 1 - success,
    };
  });
  const q = Array.from({ length: targetLevel }, () => Array(targetLevel).fill(0));
  for (const r of rates) {
    const add = (destination: number, probability: number) => { if (destination < targetLevel) q[r.level]![destination]! += probability; };
    add(r.level + 1, r.normalUp); add(r.level + 2, r.leapUp);
    add(r.level >= protectLevel ? r.level - 1 : 0, r.failure);
  }
  return { q, rates };
}

function solveLinear(matrix: number[][], rightSides: number[][]): number[][] {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, ...rightSides[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const divisor = a[col]![col]!;
    if (Math.abs(divisor) < 1e-14) throw new Error('enhancement transition matrix is singular');
    for (let j = col; j < a[col]!.length; j++) a[col]![j]! /= divisor;
    for (let row = 0; row < n; row++) if (row !== col) {
      const factor = a[row]![col]!;
      for (let j = col; j < a[row]!.length; j++) a[row]![j]! -= factor * a[col]![j]!;
    }
  }
  return a.map(row => row.slice(n));
}

/** Solve the fundamental matrix once; every row supplies one starting level. */
function solveAllOrigins(q: number[][], cacheKey: string) {
  const cached = matrixCache.get(cacheKey);
  if (cached) return cached;
  const n = q.length;
  const inverse = solveLinear(
    Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - q[i]![j]!)),
    Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0)),
  );
  const means = inverse.map(row => row.reduce((sum, value) => sum + value, 0));
  const secondRight = q.map((row, i) => [1 + 2 * row.reduce((sum, probability, j) => sum + probability * means[j]!, 0)]);
  const seconds = solveLinear(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - q[i]![j]!)), secondRight);
  const result = { visitsByOrigin: inverse, varianceByOrigin: seconds.map((row, i) => Math.max(0, row[0]! - means[i]! ** 2)) };
  matrixCache.set(cacheKey, result);
  if (matrixCache.size > 2_000) matrixCache.delete(matrixCache.keys().next().value!);
  return result;
}

export function evaluateEnhancementStrategy(input: StrategyInput): EnhancementStrategyResult {
  const { snapshot, item, targetLevel, protectLevel } = input; const origin = input.originLevel ?? 0;
  if (origin < 0 || origin >= targetLevel) throw new RangeError('origin level must be below target');
  const buffs = input.buffs ?? { playerLevel: 0, success: 0, blessed: 0, experience: 0, speed: 0 };
  const { q, rates } = buildEnhancementTransitions(item, buffs, targetLevel, protectLevel);
  const matrixKey = `${item.itemLevel ?? 0}:${targetLevel}:${protectLevel}:${buffs.playerLevel}:${buffs.success}:${buffs.blessed}:${item.steps.slice(0, targetLevel).map(step => step.baseSuccessRate).join(',')}`;
  const solved = solveAllOrigins(q, matrixKey);
  const visits = solved.visitsByOrigin[origin]!; const quotes = quoteIndex(snapshot);
  const missing = new Set<string>(); const ask = (hrid: string, level = 0) => { if (hrid === '/items/coin') return 1; const value = quotes.get(key(hrid, level))?.ask; if (value == null) missing.add(`${hrid}@+${level}:ask`); return value ?? NaN; };
  const bid = (hrid: string, level = 0) => { const value = quotes.get(key(hrid, level))?.bid; if (value == null) missing.add(`${hrid}@+${level}:bid`); return value ?? NaN; };
  const protectionHrids = [...(item.protectionItemHrids?.length ? item.protectionItemHrids : [item.itemHrid]), '/items/mirror_of_protection'];
  const protectionCandidates = protectionHrids.map(hrid => ({ hrid, price: quotes.get(key(hrid, 0))?.ask ?? NaN })).filter(x => Number.isFinite(x.price));
  const protection = protectionCandidates.reduce<{hrid: string; price: number} | null>((best, x) => !best || x.price < best.price ? x : best, null);
  const expectedProtections = rates.reduce((sum, r) => sum + visits[r.level]! * r.failure * (r.level >= protectLevel ? 1 : 0), 0);
  if (expectedProtections !== 0 && !protection) missing.add('protection-item:ask');
  const marketBasePrice = quotes.get(key(item.itemHrid, origin))?.ask;
  let manufactureCost = NaN;
  if (input.manufactureBase && origin === 0 && item.manufactureMaterials) {
    const manufactureInputs = item.manufactureUpgradeItemHrid
      ? [{ itemHrid: item.manufactureUpgradeItemHrid, quantity: 1 }, ...item.manufactureMaterials]
      : item.manufactureMaterials;
    manufactureCost = manufactureInputs.reduce((sum, material) => {
      const price = material.itemHrid === '/items/coin' ? 1 : quotes.get(key(material.itemHrid, 0))?.ask;
      return price == null ? NaN : sum + material.quantity * price;
    }, 0);
  }
  const useManufacture = Number.isFinite(manufactureCost) && (marketBasePrice == null || marketBasePrice > manufactureCost);
  if (marketBasePrice == null && !useManufacture && input.manufactureBase && origin === 0) {
    for (const material of [...(item.manufactureUpgradeItemHrid ? [{ itemHrid: item.manufactureUpgradeItemHrid, quantity: 1 }] : []), ...(item.manufactureMaterials ?? [])]) if (material.itemHrid !== '/items/coin' && quotes.get(key(material.itemHrid, 0))?.ask == null) missing.add(`${material.itemHrid}@+0:ask`);
  }
  const baseItemCost = useManufacture ? manufactureCost : ask(item.itemHrid, origin); let materialCost = 0; let totalExperience = 0; const materialQuantities = new Map<string, number>();
  const steps = rates.map(r => {
    const attempts = visits[r.level]!; let cost = 0;
    for (const material of item.steps[r.level]!.materials) {
      const quantity = attempts * material.quantity;
      cost += quantity * ask(material.itemHrid);
      materialQuantities.set(material.itemHrid, (materialQuantities.get(material.itemHrid) ?? 0) + quantity);
    }
    // Experience belongs to the attempted enhancement step. In particular,
    // +0 -> +1 and +1 -> +2 do not award the same base experience.
    const experience = attempts * (r.success + .1 * r.failure) * item.steps[r.level]!.experience * (1 + buffs.experience);
    materialCost += cost; totalExperience += experience;
    return { level: r.level, successRate: r.success, normalUpRate: r.normalUp, leapUpRate: r.leapUp, failureRate: r.failure, attempts, protections: attempts * r.failure * (r.level >= protectLevel ? 1 : 0), experience, materialCost: cost };
  });
  const protectionCost = expectedProtections * (protection?.price ?? NaN); if (expectedProtections === 0) { /* NaN-free no-protection strategy */ }
  const actualProtectionCost = expectedProtections === 0 ? 0 : protectionCost;
  const grossRevenue = bid(item.itemHrid, targetLevel); const marketFee = grossRevenue * (input.marketFeeRate ?? .05);
  const cashCost = baseItemCost + materialCost + actualProtectionCost; const netRevenue = grossRevenue - marketFee;
  const expectedProfit = netRevenue - cashCost; const expectedActions = visits.reduce((a, b) => a + b, 0); const calculable = missing.size === 0 && [cashCost, grossRevenue].every(Number.isFinite);
  return { protectLevel, protectionItemHrid: expectedProtections ? protection?.hrid ?? null : null, calculable, missingPrices: [...missing], expectedActions, expectedProtections, materialPurchases: [...materialQuantities].map(([itemHrid, quantity]) => ({ itemHrid, quantity })), baseItemSource: useManufacture ? 'manufacture' : 'market', manufactureCost,
    expectedTime: expectedActions * (input.actionSeconds ?? 0) / (1 + buffs.speed + Math.max(0, buffs.playerLevel - (item.itemLevel ?? 0)) * .01), baseItemCost, materialCost, protectionCost: actualProtectionCost, cashCost,
    grossRevenue, marketFee, netRevenue, expectedProfit, profitRate: expectedProfit / cashCost, totalExperience, netTrainingCost: cashCost - netRevenue,
    costPerExperience: (cashCost - netRevenue) / totalExperience, visits, steps, attemptVariance: solved.varianceByOrigin[origin]! };
}

export function evaluateProtectionStrategies(input: Omit<StrategyInput, 'protectLevel'>): ProtectionEvaluation | null {
  const allStrategies = Array.from({ length: input.targetLevel }, (_, i) => evaluateEnhancementStrategy({ ...input, protectLevel: i + 1 }));
  const valid = allStrategies.filter(x => x.calculable); if (!valid.length) return null;
  // Compare policies by earnings per unit of player time. A cheaper policy can
  // take sufficiently longer that it is the worse protection policy in play.
  const hourlyProfit = (strategy: EnhancementStrategyResult) => strategy.expectedTime > 0 ? strategy.expectedProfit * 3600 / strategy.expectedTime : -Infinity;
  return { bestStrategy: valid.reduce((a, b) => hourlyProfit(b) > hourlyProfit(a) ? b : a), allStrategies };
}

/** Shared project set; profit and training views only sort/filter these rows differently. */
export function calculateRankings(snapshot: MarketSnapshot, items: readonly EnhanceableItem[], buffs: EnhancingBuffs | number, now = new Date(), marketFeeRate = .05, hourlyRate = 0, actionSeconds = 12, manufactureBase = false, allowMissingFinishedBid = false): RankingRow[] {
  const resolved = typeof buffs === 'number' ? { playerLevel: buffs, success: 0, blessed: 0, experience: 0, speed: 0 } : buffs; const rows: RankingRow[] = []; const quotes = quoteIndex(snapshot);
  // A market-only shortlist is not valid here: player buffs can change which
  // project wins. Enumerate every origin/target pair that has usable quotes.
  const candidates: { item: EnhanceableItem; originLevel: number; targetLevel: number }[] = [];
  for (const item of items) for (let originLevel = 0; originLevel < item.steps.length; originLevel++) for (let targetLevel = originLevel + 1; targetLevel <= item.steps.length; targetLevel++) {
    const buy = quotes.get(key(item.itemHrid, originLevel)); const sell = quotes.get(key(item.itemHrid, targetLevel));
    // History can replace a missing bid, but it cannot identify an enhancement
    // level that has no market quote at all. Requiring the quote also keeps the
    // listing/volume metadata below safe to read.
    if (!sell || ((!manufactureBase || originLevel !== 0) && buy?.ask == null) || (!allowMissingFinishedBid && sell.bid == null)) continue;
    candidates.push({ item, originLevel, targetLevel });
  }
  for (const { item, originLevel, targetLevel } of candidates) {
    const buy = quotes.get(key(item.itemHrid, originLevel)); const sell = quotes.get(key(item.itemHrid, targetLevel))!;
    const evaluation = evaluateProtectionStrategies({ snapshot, item, originLevel, targetLevel, buffs: resolved, marketFeeRate, actionSeconds, manufactureBase });
    if (!evaluation && !(allowMissingFinishedBid && sell.bid == null)) continue;
    const resolvedEvaluation = evaluation ?? evaluateProtectionStrategiesWithPlaceholderBid(snapshot, { item, originLevel, targetLevel, buffs: resolved, marketFeeRate, actionSeconds, manufactureBase });
    if (!resolvedEvaluation) continue;
    const b = resolvedEvaluation.bestStrategy;
    const midpoint = buy?.ask == null ? 0 : (buy.ask + (buy.bid ?? buy.ask)) / 2; const spread = midpoint ? (buy!.ask! - (buy!.bid ?? buy!.ask!)) / midpoint : 0; const volume = buy ? Math.min(buy.hourlyVolume, sell.hourlyVolume) : sell.hourlyVolume; const risks: string[] = [];
    if (volume < 5) risks.push('低成交量'); if (spread > .2) risks.push('买卖价差较大'); if ((now.valueOf() - new Date(snapshot.timestamp).valueOf()) / 36e5 > 2) risks.push('市场数据陈旧');
    const totalCost = b.cashCost + b.marketFee;
    const profit = b.grossRevenue - totalCost;
    // Phase one deliberately uses only exact moments. Monte Carlo is an optional,
    // asynchronous refinement and never delays the full ranking.
    const actionDeviation = Math.sqrt(b.attemptVariance);
    const coefficientOfVariation = b.expectedActions > 0 ? actionDeviation / b.expectedActions : 0;
    const profitDeviation = (b.materialCost + b.protectionCost) * coefficientOfVariation;
    const p10 = profit - 1.281551565545 * profitDeviation;
    const p90 = profit + 1.281551565545 * profitDeviation;
    const lossProbability = profitDeviation > 0 ? normalCdf(-profit / profitDeviation) : profit < 0 ? 1 : 0;
    const downsideLossRate = totalCost > 0 ? Math.min(1, Math.max(0, -p10) / totalCost) : 0;
    const riskScore = 100 * (lossProbability * .6 + downsideLossRate * .4);
    rows.push({ id: `${item.itemHrid}:${originLevel}:${targetLevel}`, itemHrid: item.itemHrid, itemName: item.name, fromLevel: originLevel, toLevel: targetLevel, bestStrategy: b, allStrategies: resolvedEvaluation.allStrategies,
      expectedAttempts: b.expectedActions, expectedProtections: b.expectedProtections, totalExperience: b.totalExperience, purchaseCost: b.baseItemCost, materialCost: b.materialCost, protectionCost: b.protectionCost,
      capitalRequired: b.cashCost, grossSaleRevenue: b.grossRevenue, marketFee: b.marketFee, saleRevenue: b.netRevenue, totalCost, profit, profitRate: totalCost > 0 ? profit/totalCost : NaN,
      expectedTime:b.expectedTime, experiencePerHour:b.expectedTime > 0 ? b.totalExperience*3600/b.expectedTime : null, experiencePerGold:totalCost > 0 ? b.totalExperience/totalCost : null, experienceEfficiency:null, hourlyProfit:b.expectedTime > 0 ? profit*3600/b.expectedTime : null, attemptVariance:b.attemptVariance,
      netTrainingCost: b.netTrainingCost, costPerExperience: b.costPerExperience, recent72hVolume:null, volume, spread, snapshotTimestamp: snapshot.timestamp, formulaVersion: FORMULA_VERSION, gameDataVersion: GAME_DATA_VERSION, risks,
      marketListingPrice: sell.bid ?? null, marketSellingPrice: sell.ask ?? null, lossProbability, profitP10:p10, profitP50:profit, profitP90:p90, downsideLossRate, riskScore, riskLevel:riskLevel(riskScore), simulationRuns:0 });
  }
  applyExperienceEfficiency(rows);
  return rows;
}

function evaluateProtectionStrategiesWithPlaceholderBid(snapshot: MarketSnapshot, input: Omit<StrategyInput, 'protectLevel' | 'snapshot'>): ProtectionEvaluation | null {
  const quotes = snapshot.quotes.map(quote => quote.itemHrid === input.item.itemHrid && quote.enhancementLevel === input.targetLevel ? { ...quote, bid: quote.bid ?? 0 } : quote);
  if (!quotes.some(quote => quote.itemHrid === input.item.itemHrid && quote.enhancementLevel === input.targetLevel)) quotes.push({ itemHrid: input.item.itemHrid, enhancementLevel: input.targetLevel, bid: 0, ask: null, hourlyAverage: 0, hourlyVolume: 0 });
  return evaluateProtectionStrategies({ ...input, snapshot: { ...snapshot, quotes } });
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1; const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + .3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x));
  return (1 + erf) / 2;
}

/** Optional phase-two refinement for a shortlisted or explicitly opened row. */
export function simulateRankingRisk(row: RankingRow, runs = 1_000): Pick<RankingRow, 'lossProbability' | 'profitP10' | 'profitP50' | 'profitP90' | 'downsideLossRate' | 'riskScore' | 'riskLevel' | 'simulationRuns'> {
  const rng = random(hash(row.id)); const profits: number[] = []; let losses = 0;
  for (let run = 0; run < runs; run++) {
    let level = row.fromLevel; let cost = row.purchaseCost + row.marketFee;
    while (level < row.toLevel) {
      const step = row.bestStrategy.steps[level]!; const attemptCost = step.materialCost / step.attempts;
      if (level === 0 && step.failureRate > 0) {
        const failures = Math.floor(Math.log1p(-rng()) / Math.log(step.failureRate));
        cost += (failures + 1) * attemptCost;
        level += rng() * step.successRate < step.normalUpRate ? 1 : 2; continue;
      }
      cost += attemptCost; const roll = rng();
      if (roll < step.normalUpRate) level++; else if (roll < step.normalUpRate + step.leapUpRate) level += 2;
      else if (level >= row.bestStrategy.protectLevel) { cost += row.protectionCost / row.expectedProtections; level--; } else level = 0;
    }
    const profit = row.grossSaleRevenue - cost; profits.push(profit); if (profit < 0) losses++;
  }
  profits.sort((a, b) => a - b); const at = (p: number) => profits[Math.floor((runs - 1) * p)]!;
  const lossProbability = losses / runs, p10 = at(.1), downsideLossRate = row.totalCost > 0 ? Math.min(1, Math.max(0, -p10) / row.totalCost) : 0;
  const riskScore = 100 * (lossProbability * .6 + downsideLossRate * .4);
  return { lossProbability, profitP10: p10, profitP50: at(.5), profitP90: at(.9), downsideLossRate, riskScore, riskLevel: riskLevel(riskScore), simulationRuns: runs };
}

function hash(value: string): number { let h = 2166136261; for (const c of value) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function random(seed: number) { let state = seed || 1; return () => { state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function riskLevel(score:number) { return score<=20?'很低':score<=40?'低':score<=60?'中':score<=80?'高':'很高'; }
function percentileRanks(values:number[]) { const sorted=[...values].sort((a,b)=>a-b), ranks=new Map<number,number>(); for(let start=0;start<sorted.length;) { let end=start+1; while(end<sorted.length&&sorted[end]===sorted[start])end++; ranks.set(sorted[start]!,sorted.length===1?1:((start+end-1)/2)/(sorted.length-1)); start=end; } return ranks; }
export function applyExperienceEfficiency(rows:RankingRow[]) { const time=rows.flatMap(r=>r.experiencePerHour==null?[]:[r.experiencePerHour]), gold=rows.flatMap(r=>r.experiencePerGold==null?[]:[r.experiencePerGold]), timeRanks=percentileRanks(time), goldRanks=percentileRanks(gold); for(const r of rows) { r.experienceEfficiency=null; if(r.experiencePerHour!=null&&r.experiencePerGold!=null) r.experienceEfficiency=100*Math.sqrt(timeRanks.get(r.experiencePerHour)!*goldRanks.get(r.experiencePerGold)!); } }

export const rankProfitProjects = (rows: readonly RankingRow[]) => rows.filter(r => r.profit > 0).sort((a, b) => (b.hourlyProfit ?? -Infinity) - (a.hourlyProfit ?? -Infinity));
export const rankTrainingProjects = (rows: readonly RankingRow[]) => [...rows].sort((a, b) => a.costPerExperience - b.costPerExperience);

export interface RankingBatch { rows: RankingRow[]; candidateCount: number; successCount: number; excludedMissingPriceCount: number; exactCalculationMs: number; riskCalculationMs: number }

export function calculateRankingBatch(snapshot: MarketSnapshot, items: readonly EnhanceableItem[], buffs: EnhancingBuffs, now = new Date(), marketFeeRate = .05, hourlyRate = 0, actionSeconds = 12, manufactureBase = false, allowMissingFinishedBid = false): RankingBatch {
  const started = performance.now();
  const candidateCount = items.reduce((sum, item) => sum + item.steps.length * (item.steps.length + 1) / 2, 0);
  const rows = calculateRankings(snapshot, items, buffs, now, marketFeeRate, hourlyRate, actionSeconds, manufactureBase, allowMissingFinishedBid);
  return { rows, candidateCount, successCount: rows.length, excludedMissingPriceCount: candidateCount - rows.length, exactCalculationMs: performance.now() - started, riskCalculationMs: 0 };
}
