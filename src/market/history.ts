import { applyExperienceEfficiency, riskLevel, type RankingRow } from '../enhancing/calculator.js';
export type LiquidityGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export interface FinishedItemValuation { expectedPrice: number | null; averageDailyVolume7d: number; volume: number; activeBuyVolume7d: number; activeSellVolume7d: number; windowDays: 7; liquidityGrade: LiquidityGrade; expectedSaleWaitHours: number | null; currentAsk?: number }
export interface MarketHistoryPoint { time: string | number; average: number | null; volume: number; ask: number | null; bid: number | null; activeBuyVolume: number; activeSellVolume: number }
interface Point { p: number; v: number; a: number; b: number; t: string | number }
export class MarketHistoryClient {
  private cache = new Map<string, { expires: number; value: Promise<FinishedItemValuation> }>(); private seriesCache = new Map<string, { expires: number; value: Promise<Point[]> }>(); private active = 0; private waiting: Array<() => void> = [];
  constructor(private fetcher: typeof fetch = fetch, private concurrency = 6, private cacheMs = 3_600_000, private now = Date.now, private timeoutMs = 8_000, private maxAttempts = 2, private priceTolerance = .02) { if (concurrency < 1) throw new RangeError('history concurrency must be positive'); if (priceTolerance < 0 || priceTolerance >= .5) throw new RangeError('price tolerance must be between 0 and .5'); }
  valuation(itemHrid: string, level: number): Promise<FinishedItemValuation> {
    const key = `${itemHrid}\0${level}`, old = this.cache.get(key); if (old && old.expires > this.now()) return old.value;
    const value = this.load(itemHrid, level).catch(error => { this.cache.delete(key); throw error; }); this.cache.set(key, { expires: this.now() + this.cacheMs, value }); return value;
  }
  async history(itemHrid: string, level: number, days: number): Promise<MarketHistoryPoint[]> {
    if (![1, 3, 7, 14, 30, 90, 180, 365].includes(days)) throw new RangeError('unsupported history range');
    const points = sanitizeOrders(await this.request(itemHrid, level, days));
    const estimates = estimateActiveVolumes(points, this.priceTolerance);
    return points.map((point, index) => ({
      time: point.t || index, average: point.p > 0 && point.v > 0 ? point.p : null, volume: point.p > 0 && point.v > 0 ? point.v : 0,
      ask: point.a > 0 ? point.a : null, bid: point.b > 0 ? point.b : null,
      activeBuyVolume: estimates[index]!.activeBuyVolume, activeSellVolume: estimates[index]!.activeSellVolume,
    }));
  }
  private async load(item: string, level: number) {
    const points=sanitizeOrders(await this.request(item, level, 7)), seven = summarize(points);
    // Use the same retained trades for the total and its two aggressor-side
    // buckets.  Otherwise an outlier excluded from `volume` could still be
    // counted as an active buy/sell and the displayed counts would disagree.
    const averageDailyVolume7d = seven.volume / 7, active = estimateActiveVolumes(seven.points, this.priceTolerance);
    const activeBuyVolume7d = active.reduce((sum, point) => sum + point.activeBuyVolume, 0), activeSellVolume7d = active.reduce((sum, point) => sum + point.activeSellVolume, 0);
    const currentAsk=[...points].reverse().find(point=>point.a>0)?.a;
    return { expectedPrice: seven.price, averageDailyVolume7d, volume: seven.volume, activeBuyVolume7d, activeSellVolume7d, windowDays: 7, liquidityGrade: seven.volume >= 28 ? 'S' : seven.volume >= 7 ? 'A' : seven.volume >= 1 ? 'B' : seven.volume > 0 ? 'C' : 'D', expectedSaleWaitHours: seven.volume ? 168 / seven.volume : null, ...(currentAsk==null?{}:{currentAsk}) } satisfies FinishedItemValuation;
  }
  private async request(item: string, level: number, days: number): Promise<Point[]> {
    const key=`${item}\0${level}\0${days}`,old=this.seriesCache.get(key);if(old&&old.expires>this.now())return old.value;
    const value=this.requestUncached(item,level,days).catch(error=>{this.seriesCache.delete(key);throw error;});this.seriesCache.set(key,{expires:this.now()+this.cacheMs,value});return value;
  }
  private async requestUncached(item: string, level: number, days: number): Promise<Point[]> {
    if (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve)); this.active++;
    try { const url = new URL('https://q7.nainai.eu.org/api/market/history'); url.searchParams.set('item_id', item); url.searchParams.set('variant', String(level)); url.searchParams.set('days', String(days)); let error: unknown;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) try { const response = await this.fetcher(url, { signal: AbortSignal.timeout(this.timeoutMs) }); if (!response.ok) throw new Error(`Mooket II history HTTP ${response.status}`); return parse(await response.json()); } catch (caught) { error = caught; }
      throw error;
    }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}
export function estimateActiveVolumes(points: Point[], tolerance = .02): Array<{ activeBuyVolume: number; activeSellVolume: number }> {
  const day = (time: string | number) => { const date = new Date(typeof time === 'number' && time < 1e12 ? time * 1000 : time); return Number.isNaN(date.valueOf()) ? String(time) : date.toISOString().slice(0, 10); };
  const median = (values: number[]) => { values.sort((a,b)=>a-b); const m=Math.floor(values.length/2); return values.length%2?values[m]!:(values[m-1]!+values[m]!)/2; };
  const references = new Map<string, { ask?: number; bid?: number }>();
  for (const key of new Set(points.map(point => day(point.t)))) { const daily=points.filter(point=>day(point.t)===key); const asks=daily.map(x=>x.a).filter(x=>x>0), bids=daily.map(x=>x.b).filter(x=>x>0); references.set(key,{...(asks.length?{ask:median(asks)}:{}),...(bids.length?{bid:median(bids)}:{})}); }
  return points.map(point => {
    if (!(point.p > 0 && point.v > 0)) return { activeBuyVolume: 0, activeSellVolume: 0 };
    const {ask,bid}=references.get(day(point.t))!;
    const nearAsk=ask != null && Math.abs(point.p-ask)/ask<=tolerance, nearBid=bid != null && Math.abs(point.p-bid)/bid<=tolerance;
    // A trade close to a day's representative listing is evidence that the whole
    // reported volume crossed that side.  Do this before interpolation: intraday
    // listing movement must not turn an obvious ask-side trade into half a trade.
    if (nearAsk !== nearBid) return nearAsk ? { activeBuyVolume: point.v, activeSellVolume: 0 } : { activeBuyVolume: 0, activeSellVolume: point.v };
    // Every traded item must belong to exactly one of the two aggressor-side
    // buckets.  With only one quote, prices on/through the ask are active buys
    // and prices on/through the bid are active sells; a price away from that
    // known edge is assigned to the opposite side.  If neither edge survived
    // sanitization, split the indivisible quantity deterministically instead
    // of silently dropping it.
    if (ask == null && bid == null) { const activeBuyVolume=Math.round(point.v/2); return { activeBuyVolume, activeSellVolume: point.v-activeBuyVolume }; }
    if (bid == null) return point.p >= ask! * (1-tolerance) ? { activeBuyVolume: point.v, activeSellVolume: 0 } : { activeBuyVolume: 0, activeSellVolume: point.v };
    if (ask == null) return point.p <= bid * (1+tolerance) ? { activeBuyVolume: 0, activeSellVolume: point.v } : { activeBuyVolume: point.v, activeSellVolume: 0 };
    const ratio=ask>bid?Math.max(0,Math.min(1,(point.p-bid)/(ask-bid))):Math.abs(point.p-ask)<=Math.abs(point.p-bid)?1:0;
    const activeBuyVolume=Math.round(point.v*ratio);
    return { activeBuyVolume, activeSellVolume: point.v-activeBuyVolume };
  });
}
function parse(payload: unknown): Point[] { const values = Array.isArray(payload) ? payload : payload && typeof payload === 'object' ? Object.values(payload as Record<string, unknown>).find(Array.isArray) : null; if (!Array.isArray(values)) throw new Error('Mooket II history payload has no data array'); return values.flatMap((x, index) => { if (!x || typeof x !== 'object') return []; const raw=x as Record<string, unknown>,p=Number(raw.p),v=Number(raw.v),a=Number(raw.a),b=Number(raw.b),t=raw.t??raw.time??raw.timestamp??raw.date??index; return Number.isFinite(p)&&Number.isFinite(v)?[{ p, v, a:Number.isFinite(a)?a:-1, b:Number.isFinite(b)?b:-1, t:typeof t==='string'||typeof t==='number'?t:index }]:[]; }); }
function sanitizeOrders(points: Point[]): Point[] {
  const bounds = (field: 'a' | 'b') => {
    const values = points.map(point => point[field]).filter(value => value > 0).sort((a, b) => a - b);
    if (values.length < 3) return null;
    const middle = Math.floor(values.length / 2), median = values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
    return [median * .65, median * 1.35] as const;
  };
  const askBounds = bounds('a'), bidBounds = bounds('b');
  return points.map(point => ({ ...point,
    a: point.a > 0 && (!askBounds || point.a >= askBounds[0] && point.a <= askBounds[1]) ? point.a : -1,
    b: point.b > 0 && (!bidBounds || point.b >= bidBounds[0] && point.b <= bidBounds[1]) ? point.b : -1,
  }));
}
function summarize(points: Point[]) {
  points = points.filter(point => point.p > 0 && point.v > 0);
  if (!points.length) return { volume: 0, price: null, points };
  const prices = points.map(point => point.p).sort((a, b) => a - b), middle = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[middle]! : (prices[middle - 1]! + prices[middle]!) / 2;
  const retained = points.filter(point => Math.abs(point.p - median) / median <= .35);
  const volume = retained.reduce((sum, point) => sum + point.v, 0);
  return { volume, price: Math.round(retained.reduce((sum, point) => sum + point.p * point.v, 0) / volume), points: retained };
}
export function applyFinishedItemValuation(row: RankingRow, valuation: FinishedItemValuation, feeRate: number): RankingRow | null {
  if (valuation.liquidityGrade === 'D' || valuation.expectedPrice == null) return null; const r = structuredClone(row), price = valuation.expectedPrice;
  const update = (s: RankingRow['bestStrategy']) => { s.grossRevenue = price; s.marketFee = price * feeRate; s.netRevenue = price * (1 - feeRate); s.expectedProfit = s.netRevenue - s.cashCost; s.profitRate = s.expectedProfit / s.cashCost; s.netTrainingCost = s.cashCost - s.netRevenue; s.costPerExperience = s.netTrainingCost / s.totalExperience; };
  r.allStrategies.forEach(update);
  r.bestStrategy = r.allStrategies.filter(s => s.calculable).reduce((a, b) => b.expectedProfit / b.expectedTime > a.expectedProfit / a.expectedTime ? b : a);
  const best = r.bestStrategy; r.expectedAttempts = best.expectedActions; r.expectedProtections = best.expectedProtections; r.totalExperience = best.totalExperience; r.purchaseCost = best.baseItemCost; r.materialCost = best.materialCost; r.protectionCost = best.protectionCost; r.capitalRequired = best.cashCost; r.expectedTime = best.expectedTime; r.attemptVariance = best.attemptVariance;
  r.grossSaleRevenue = price; r.marketFee = price * feeRate; r.saleRevenue = price * (1 - feeRate); r.totalCost = r.capitalRequired + r.marketFee; r.profit = r.saleRevenue - r.capitalRequired; r.profitRate = r.totalCost ? r.profit / r.totalCost : NaN; r.hourlyProfit = r.expectedTime ? r.profit * 3600 / r.expectedTime : null; r.netTrainingCost = r.capitalRequired - r.saleRevenue; r.costPerExperience = r.netTrainingCost / r.totalExperience; r.experiencePerGold = r.totalCost > 0 ? r.totalExperience / r.totalCost : null;
  const coefficient = r.expectedAttempts > 0 ? Math.sqrt(r.attemptVariance) / r.expectedAttempts : 0, deviation = (r.materialCost + r.protectionCost) * coefficient;
  r.profitP10 = r.profit - 1.281551565545 * deviation; r.profitP50 = r.profit; r.profitP90 = r.profit + 1.281551565545 * deviation; r.lossProbability = deviation > 0 ? normalCdf(-r.profit / deviation) : r.profit < 0 ? 1 : 0; r.downsideLossRate = r.totalCost > 0 ? Math.min(1, Math.max(0, -r.profitP10) / r.totalCost) : 0; r.riskScore = 100 * (r.lossProbability * .6 + r.downsideLossRate * .4); r.riskLevel = riskLevel(r.riskScore); r.simulationRuns = 0;
  r.recent72hVolume = null; r.historyVolume = valuation.volume; r.activeBuyVolume7d = valuation.activeBuyVolume7d; r.activeSellVolume7d = valuation.activeSellVolume7d; r.historyWindowDays = valuation.windowDays; r.averageDailyVolume7d = valuation.averageDailyVolume7d; r.expectedPrice = price; r.liquidityGrade = valuation.liquidityGrade; r.expectedSaleWaitHours = valuation.expectedSaleWaitHours; if (valuation.currentAsk != null) r.marketSellingPrice=valuation.currentAsk; return r;
}

export function finishHistoricalRanking(rows: RankingRow[]): RankingRow[] { applyExperienceEfficiency(rows); return rows; }
function normalCdf(value: number) { const sign=value<0?-1:1,x=Math.abs(value)/Math.sqrt(2),t=1/(1+.3275911*x); const erf=sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x)); return (1+erf)/2; }
