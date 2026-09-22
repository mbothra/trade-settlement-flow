/**
 * Price Simulation Module
 *
 * Generates bounded random walk prices for BTC/USDC, ETH/USDC and SOL/USDC.
 * Streaming prices update every 1–2 seconds.  Completed trade values are
 * stored separately in the trade record and are never affected by subsequent
 * price movements.
 */

import type { PriceMap, TradingPair, PriceSnapshot } from '../store/types';

// Initial mid-prices (illustrative historical-style values)
const MID_PRICES: Record<TradingPair, number> = {
  'BTC/USDC': 80_000,
  'ETH/USDC': 3_000,
  'SOL/USDC': 145,
};

// Half-spread
const SPREAD: Record<TradingPair, number> = {
  'BTC/USDC': 15,   // ±$15 half-spread on BTC
  'ETH/USDC': 1.5,
  'SOL/USDC': 0.05,
};

// Maximum drift from initial mid in one direction
const MAX_DRIFT: Record<TradingPair, number> = {
  'BTC/USDC': 2_000,
  'ETH/USDC': 200,
  'SOL/USDC': 20,
};

// Tick size — max change per update
const TICK: Record<TradingPair, number> = {
  'BTC/USDC': 50,
  'ETH/USDC': 5,
  'SOL/USDC': 0.25,
};

let currentMids: Record<TradingPair, number> = { ...MID_PRICES };

/** Produces the initial price map (used for store initialisation). */
export function initialPrices(): PriceMap {
  const now = Date.now();
  const map = {} as PriceMap;
  for (const pair of Object.keys(MID_PRICES) as TradingPair[]) {
    const mid = currentMids[pair];
    const half = SPREAD[pair];
    map[pair] = { bid: mid - half, ask: mid + half, timestamp: now, flash: null };
  }
  return map;
}

/** Advance mid-prices by one random walk step and return new PriceMap. */
export function tickPrices(prev: PriceMap): PriceMap {
  const now = Date.now();
  const map = {} as PriceMap;

  for (const pair of Object.keys(MID_PRICES) as TradingPair[]) {
    const prevMid = currentMids[pair];
    const drift = (Math.random() - 0.5) * 2 * TICK[pair];
    const raw = prevMid + drift;
    const lo = MID_PRICES[pair] - MAX_DRIFT[pair];
    const hi = MID_PRICES[pair] + MAX_DRIFT[pair];
    const newMid = Math.max(lo, Math.min(hi, raw));
    currentMids[pair] = newMid;

    const half = SPREAD[pair];
    const bid = newMid - half;
    const ask = newMid + half;

    const prevBid = prev[pair]?.bid ?? bid;
    const flash: PriceSnapshot['flash'] = bid > prevBid ? 'up' : bid < prevBid ? 'down' : null;

    map[pair] = { bid, ask, timestamp: now, flash };
  }
  return map;
}

/** Reset current mids to initial (used on demo reset). */
export function resetPrices(): void {
  currentMids = { ...MID_PRICES };
}

/** Tick interval in ms — random between 1000 and 2000. */
export function nextTickInterval(): number {
  return 1000 + Math.floor(Math.random() * 1000);
}
