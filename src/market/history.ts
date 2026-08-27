import { applyExperienceEfficiency, riskLevel, type RankingRow } from '../enhancing/calculator.js';
export type LiquidityGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export interface FinishedItemValuation { expectedPrice: number | null; recent72hVolume: number; averageDailyVolume7d: number; volume: number; windowDays: 3; liquidityGrade: LiquidityGrade; expectedSaleWaitHours: number | null }
interface Point { p: number; v: number }
export class MarketHistoryClient {
  private cache = new Map<string, { expires: number; value: Promise<FinishedItemValuation> }>(); private active = 0; private waiting: Array<() => void> = [];
  constructor(private fetcher: typeof fetch = fetch, private concurrency = 6, private cacheMs = 3_600_000, private now = Date.now, private timeoutMs = 8_000, private maxAttempts = 2) { if (concurrency < 1) throw new RangeError('history concurrency must be positive'); }
  valuation(itemHrid: string, level: number): Promise<FinishedItemValuation> {
    const key = `${itemHrid}\0${level}`, old = this.cache.get(key); if (old && old.expires > this.now()) return old.value;
    const value = this.load(itemHrid, level).catch(error => { this.cache.delete(key); throw error; }); this.cache.set(key, { expires: this.now() + this.cacheMs, value }); return value;
  }
  private async load(item: string, level: number) {
    const [three, seven] = await Promise.all([this.request(item, level, 3).then(summarize), this.request(item, level, 7).then(summarize)]);
    const averageDailyVolume7d = seven.volume / 7;
    if (three.volume) return { expectedPrice: three.price, recent72hVolume: three.volume, averageDailyVolume7d, volume: three.volume, windowDays: 3, liquidityGrade: three.volume >= 12 ? 'S' : three.volume >= 3 ? 'A' : 'B', expectedSaleWaitHours: 72 / three.volume } satisfies FinishedItemValuation;
    return { expectedPrice: seven.price, recent72hVolume: 0, averageDailyVolume7d, volume: 0, windowDays: 3, liquidityGrade: seven.volume ? 'C' : 'D', expectedSaleWaitHours: seven.volume ? 168 / seven.volume : null } satisfies FinishedItemValuation;
  }
  private async request(item: string, level: number, days: number): Promise<Point[]> {
    if (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve)); this.active++;
    try { const url = new URL('https://q7.nainai.eu.org/api/market/history'); url.searchParams.set('item_id', item); url.searchParams.set('variant', String(level)); url.searchParams.set('days', String(days)); let error: unknown;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) try { const response = await this.fetcher(url, { signal: AbortSignal.timeout(this.timeoutMs) }); if (!response.ok) throw new Error(`Mooket II history HTTP ${response.status}`); return parse(await response.json()); } catch (caught) { error = caught; }
      throw error;
    }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}
function parse(payload: unknown): Point[] { const values = Array.isArray(payload) ? payload : payload && typeof payload === 'object' ? Object.values(payload as Record<string, unknown>).find(Array.isArray) : null; if (!Array.isArray(values)) throw new Error('Mooket II history payload has no data array'); return values.flatMap(x => { if (!x || typeof x !== 'object') return []; const p = Number((x as Point).p), v = Number((x as Point).v); return Number.isFinite(p) && p >= 0 && Number.isFinite(v) && v >= 0 ? [{ p, v }] : []; }); }
function summarize(points: Point[]) { const volume = points.reduce((sum, x) => sum + x.v, 0); return { volume, price: volume ? points.reduce((sum, x) => sum + x.p * x.v, 0) / volume : null }; }
export function applyFinishedItemValuation(row: RankingRow, valuation: FinishedItemValuation, feeRate: number): RankingRow | null {
  if (valuation.liquidityGrade === 'D' || valuation.expectedPrice == null) return null; const r = structuredClone(row), price = valuation.expectedPrice;
  const update = (s: RankingRow['bestStrategy']) => { s.grossRevenue = price; s.marketFee = price * feeRate; s.netRevenue = price * (1 - feeRate); s.expectedProfit = s.netRevenue - s.cashCost; s.profitRate = s.expectedProfit / s.cashCost; s.netTrainingCost = s.cashCost - s.netRevenue; s.costPerExperience = s.netTrainingCost / s.totalExperience; };
  r.allStrategies.forEach(update);
  r.bestStrategy = r.allStrategies.filter(s => s.calculable).reduce((a, b) => b.expectedProfit / b.expectedTime > a.expectedProfit / a.expectedTime ? b : a);
  const best = r.bestStrategy; r.expectedAttempts = best.expectedActions; r.expectedProtections = best.expectedProtections; r.totalExperience = best.totalExperience; r.purchaseCost = best.baseItemCost; r.materialCost = best.materialCost; r.protectionCost = best.protectionCost; r.capitalRequired = best.cashCost; r.expectedTime = best.expectedTime; r.attemptVariance = best.attemptVariance;
  r.grossSaleRevenue = price; r.marketFee = price * feeRate; r.saleRevenue = price * (1 - feeRate); r.totalCost = r.capitalRequired + r.marketFee; r.profit = r.saleRevenue - r.capitalRequired; r.profitRate = r.totalCost ? r.profit / r.totalCost : NaN; r.hourlyProfit = r.expectedTime ? r.profit * 3600 / r.expectedTime : null; r.netTrainingCost = r.capitalRequired - r.saleRevenue; r.costPerExperience = r.netTrainingCost / r.totalExperience; r.experiencePerGold = r.totalCost > 0 ? r.totalExperience / r.totalCost : null;
  const coefficient = r.expectedAttempts > 0 ? Math.sqrt(r.attemptVariance) / r.expectedAttempts : 0, deviation = (r.materialCost + r.protectionCost) * coefficient;
  r.profitP10 = r.profit - 1.281551565545 * deviation; r.profitP50 = r.profit; r.profitP90 = r.profit + 1.281551565545 * deviation; r.lossProbability = deviation > 0 ? normalCdf(-r.profit / deviation) : r.profit < 0 ? 1 : 0; r.downsideLossRate = r.totalCost > 0 ? Math.min(1, Math.max(0, -r.profitP10) / r.totalCost) : 0; r.riskScore = 100 * (r.lossProbability * .6 + r.downsideLossRate * .4); r.riskLevel = riskLevel(r.riskScore); r.simulationRuns = 0;
  r.recent72hVolume = valuation.recent72hVolume; r.historyVolume = valuation.volume; r.historyWindowDays = valuation.windowDays; r.averageDailyVolume7d = valuation.averageDailyVolume7d; r.expectedPrice = price; r.liquidityGrade = valuation.liquidityGrade; r.expectedSaleWaitHours = valuation.expectedSaleWaitHours; return r;
}

export function finishHistoricalRanking(rows: RankingRow[]): RankingRow[] { applyExperienceEfficiency(rows); return rows; }
function normalCdf(value: number) { const sign=value<0?-1:1,x=Math.abs(value)/Math.sqrt(2),t=1/(1+.3275911*x); const erf=sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x)); return (1+erf)/2; }
