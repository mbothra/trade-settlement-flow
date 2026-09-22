/**
 * Settlement Netting Module
 *
 * Computes net obligations from a list of trades, netting the same asset
 * on the same network within the scope of one batch.
 *
 * From the fund's perspective:
 *   BUY  → fund pays USDC, fund receives base asset
 *   SELL → fund receives USDC, fund pays base asset
 *
 * Net obligation = (gross receives) − (gross pays) for each asset/network.
 * If positive → direction: 'receive'; if negative → direction: 'pay'.
 */

import type { Trade, Obligation, Asset, Network, ObligationDirection } from '../store/types';

const ASSET_NETWORK: Record<Asset, Network> = {
  USDC: 'Ethereum',
  BTC:  'Bitcoin',
  ETH:  'Ethereum',
  SOL:  'Solana',
};

function assetNetwork(asset: Asset): Network {
  return ASSET_NETWORK[asset];
}

interface Accumulator {
  asset: Asset;
  network: Network;
  grossReceives: number;
  grossPays: number;
  contributingTradeIds: string[];
}

/**
 * Compute net settlement obligations for a given list of trades.
 * Returns one Obligation per distinct (asset, network) with a non-zero net.
 *
 * NOTE: never reads credit state — obligations are computed from signed
 * asset movements only.
 */
export function computeNetObligations(
  trades: Trade[],
  idPrefix = 'OBL',
  startNum = 1,
): Obligation[] {
  const acc: Record<string, Accumulator> = {};
  let oblNum = startNum;

  const ensure = (asset: Asset): Accumulator => {
    const k = `${asset}:${assetNetwork(asset)}`;
    if (!acc[k]) {
      acc[k] = {
        asset,
        network: assetNetwork(asset),
        grossReceives: 0,
        grossPays: 0,
        contributingTradeIds: [],
      };
    }
    return acc[k];
  };

  for (const trade of trades) {
    const [base] = trade.pair.split('/') as [Asset];

    if (trade.side === 'buy') {
      // Fund pays USDC, receives base
      ensure('USDC').grossPays += trade.notionalUsdc;
      ensure('USDC').contributingTradeIds.push(trade.id);
      ensure(base).grossReceives += trade.baseQuantity;
      ensure(base).contributingTradeIds.push(trade.id);
    } else {
      // Fund receives USDC, pays base
      ensure('USDC').grossReceives += trade.notionalUsdc;
      ensure('USDC').contributingTradeIds.push(trade.id);
      ensure(base).grossPays += trade.baseQuantity;
      ensure(base).contributingTradeIds.push(trade.id);
    }
  }

  const obligations: Obligation[] = [];

  for (const a of Object.values(acc)) {
    const net = a.grossReceives - a.grossPays;
    if (Math.abs(net) < 1e-9) continue; // skip dust

    const direction: ObligationDirection = net < 0 ? 'pay' : 'receive';
    const netAmount = Math.abs(net);

    // De-duplicate contributing trade IDs
    const uniqueIds = [...new Set(a.contributingTradeIds)];

    obligations.push({
      id: `${idPrefix}-${String(oblNum++).padStart(3, '0')}`,
      direction,
      asset: a.asset,
      network: a.network,
      netAmount,
      verifiedAmount: 0,
      remainingAmount: netAmount,
      status: 'outstanding',
      paymentReference: null,
      paymentEvents: [],
      contributingTradeIds: uniqueIds,
      grossReceives: a.grossReceives,
      grossPays: a.grossPays,
      unappliedExcess: 0,
    });
  }

  // Consistent sort: pay obligations first, then by asset name
  obligations.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === 'pay' ? -1 : 1;
    if (a.asset !== b.asset) return a.asset.localeCompare(b.asset);
    return 0;
  });

  return obligations;
}

/**
 * Human-readable netting explanation for an obligation.
 * e.g. "Bought 10 BTC, sold 2 BTC; receive 8 BTC."
 */
export function obligationExplanation(obl: Obligation, trades: Trade[]): string {
  const relevant = trades.filter((t) => obl.contributingTradeIds.includes(t.id));
  const [base] = obl.asset === 'USDC' ? ['USDC'] : [obl.asset];

  if (obl.asset === 'USDC') {
    const totalPaid = relevant
      .filter((t) => t.side === 'buy')
      .reduce((s, t) => s + t.notionalUsdc, 0);
    const totalReceived = relevant
      .filter((t) => t.side === 'sell')
      .reduce((s, t) => s + t.notionalUsdc, 0);
    if (obl.direction === 'pay') {
      return `Paid ${fmt(totalPaid, 'USDC')} for purchases, received ${fmt(totalReceived, 'USDC')} from sales; net pay ${fmt(obl.netAmount, 'USDC')}.`;
    }
    return `Received ${fmt(totalReceived, 'USDC')} from sales, paid ${fmt(totalPaid, 'USDC')} for purchases; net receive ${fmt(obl.netAmount, 'USDC')}.`;
  }

  const buys  = relevant.filter((t) => t.side === 'buy'  && t.pair.startsWith(base));
  const sells = relevant.filter((t) => t.side === 'sell' && t.pair.startsWith(base));
  const buyQty  = buys.reduce((s, t) => s + t.baseQuantity, 0);
  const sellQty = sells.reduce((s, t) => s + t.baseQuantity, 0);

  const parts: string[] = [];
  if (buyQty  > 0) parts.push(`Bought ${fmt(buyQty,  base as Asset)}`);
  if (sellQty > 0) parts.push(`sold ${fmt(sellQty, base as Asset)}`);

  const verb = obl.direction === 'receive' ? 'receive' : 'pay';
  return `${parts.join(', ')}; ${verb} ${fmt(obl.netAmount, base as Asset)}.`;
}

function fmt(n: number, asset: Asset): string {
  if (asset === 'USDC') return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + ' USDC';
  if (asset === 'BTC')  return n.toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' BTC';
  if (asset === 'ETH')  return n.toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ETH';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 }) + ` ${asset}`;
}
