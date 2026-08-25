export interface MarketQuote {
  itemHrid: string;
  enhancementLevel: number;
  ask: number | null;
  bid: number | null;
  hourlyAverage: number | null;
  hourlyVolume: number;
}

export interface MarketSnapshot {
  timestamp: string;
  quotes: MarketQuote[];
}

export interface StoredSnapshot {
  timestamp: string;
  path: string;
  quoteCount: number;
}
