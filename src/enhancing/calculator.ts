import { FORMULA_VERSION, GAME_DATA_VERSION, type EnhanceableItem } from '../game-data/catalog.js';
import type { MarketQuote, MarketSnapshot } from '../market/types.js';

export interface RankingRow {
  id: string; itemHrid: string; itemName: string; fromLevel: number; toLevel: number;
  successRate: number; expectedAttempts: number; totalExperience: number;
  purchaseCost: number; materialCost: number; saleRevenue: number; profit: number;
  grossSaleRevenue: number; marketFee: number; preTaxProfit: number;
  costPerExperience: number; capitalRequired: number; volume: number; spread: number;
  snapshotTimestamp: string; formulaVersion: string; gameDataVersion: string; risks: string[];
  steps: Array<{ toLevel: number; successRate: number; attempts: number; experience: number; inputCost: number; materialCost: number }>;
}

const quoteKey = (hrid: string, level: number) => `${hrid}\0${level}`;

/** Exact expected-value recurrence for destructive failures. */
export function calculateRankings(snapshot: MarketSnapshot, items: ReadonlyArray<EnhanceableItem>, playerLevel: number, now = new Date(), marketFeeRate = 0): RankingRow[] {
  if (marketFeeRate < 0 || marketFeeRate >= 1) throw new RangeError('market fee rate must be in [0, 1)');
  const quotes = new Map(snapshot.quotes.map(q => [quoteKey(q.itemHrid, q.enhancementLevel), q]));
  const rows: RankingRow[] = [];
  for (const item of items) {
    for (let from = 0; from < item.steps.length; from++) {
      for (let to = from + 1; to <= item.steps.length; to++) {
        const buy = quotes.get(quoteKey(item.itemHrid, from));
        const sell = quotes.get(quoteKey(item.itemHrid, to));
        if (buy?.ask == null || sell?.bid == null) continue;
        let expectedInputUnits = 1;
        let totalExperience = 0;
        let materialCost = 0;
        const details: RankingRow['steps'] = [];
        let valid = true;
        const selectedSteps = item.steps.slice(from, to);
        const requiredAttempts = new Map<number, number>();
        for (let index = selectedSteps.length - 1, requiredOutputs = 1; index >= 0; index--) {
          const step = selectedSteps[index]!;
          const successRate = Math.min(1, step.baseSuccessRate + playerLevel / 1000);
          const attempts = requiredOutputs / successRate;
          requiredAttempts.set(step.toLevel, attempts);
          requiredOutputs = attempts;
        }
        expectedInputUnits = requiredAttempts.get(selectedSteps[0]!.toLevel)!;
        for (const step of selectedSteps) {
          const successRate = Math.min(1, step.baseSuccessRate + playerLevel / 1000);
          const attempts = requiredAttempts.get(step.toLevel)!;
          let stepMaterials = 0;
          for (const material of step.materials) {
            const materialQuote = quotes.get(quoteKey(material.itemHrid, 0));
            if (materialQuote?.ask == null) { valid = false; break; }
            stepMaterials += attempts * material.quantity * materialQuote.ask;
          }
          if (!valid) break;
          totalExperience += attempts * step.experience;
          materialCost += stepMaterials;
          details.push({ toLevel: step.toLevel, successRate, attempts, experience: attempts * step.experience, inputCost: expectedInputUnits * buy.ask, materialCost: stepMaterials });
        }
        if (!valid) continue;
        const purchaseCost = expectedInputUnits * buy.ask;
        const totalCost = purchaseCost + materialCost;
        const grossSaleRevenue = sell.bid;
        const marketFee = grossSaleRevenue * marketFeeRate;
        const saleRevenue = grossSaleRevenue - marketFee;
        const preTaxProfit = grossSaleRevenue - totalCost;
        const profit = saleRevenue - totalCost;
        const midpoint = (buy.ask + (buy.bid ?? buy.ask)) / 2;
        const spread = midpoint ? (buy.ask - (buy.bid ?? buy.ask)) / midpoint : 0;
        const volume = Math.min(buy.hourlyVolume, sell.hourlyVolume);
        const ageHours = Math.max(0, (now.valueOf() - new Date(snapshot.timestamp).valueOf()) / 3_600_000);
        const risks: string[] = [];
        if (volume < 5) risks.push('低成交量');
        if (spread > 0.2) risks.push('买卖价差较大');
        if (ageHours > 2) risks.push('市场数据陈旧');
        rows.push({ id: `${item.itemHrid}:${from}:${to}`, itemHrid: item.itemHrid, itemName: item.name, fromLevel: from, toLevel: to,
          successRate: details.at(-1)!.successRate, expectedAttempts: expectedInputUnits, totalExperience,
          purchaseCost, materialCost, grossSaleRevenue, marketFee, saleRevenue, preTaxProfit, profit, costPerExperience: totalCost / totalExperience,
          capitalRequired: totalCost, volume, spread, snapshotTimestamp: snapshot.timestamp,
          formulaVersion: FORMULA_VERSION, gameDataVersion: GAME_DATA_VERSION, risks, steps: details });
      }
    }
  }
  return rows;
}
