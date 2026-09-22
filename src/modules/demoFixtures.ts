/**
 * Demo Guided Walkthrough Fixtures
 *
 * Sequential steps the user clicks through. Prices are illustrative
 * historical-style values, not current market prices.
 *
 * The guided mode uses these fixed prices to produce the exact credit
 * table shown in the brief. Free-exploration streaming mode derives
 * all figures from actual accepted quotes — totals may differ.
 */

import type { GuidedStep, GuidedStepKey, TradingPair, Side } from '../store/types';

export interface GuidedTradeFixture {
  pair: TradingPair;
  side: Side;
  quantity: number;
  price: number; // exact fixture price
  expectedNotional: number;
  expectedUsedCredit: number;
  expectedAvailableCredit: number;
}

export const GUIDED_TRADE_FIXTURES: Partial<Record<GuidedStepKey, GuidedTradeFixture>> = {
  'step-buy-btc': {
    pair: 'BTC/USDC',
    side: 'buy',
    quantity: 10,
    price: 80_000,
    expectedNotional: 800_000,
    expectedUsedCredit: 800_000,
    expectedAvailableCredit: 1_200_000,
  },
  'step-buy-eth': {
    pair: 'ETH/USDC',
    side: 'buy',
    quantity: 100,
    price: 3_000,
    expectedNotional: 300_000,
    expectedUsedCredit: 1_100_000,
    expectedAvailableCredit: 900_000,
  },
  'step-sell-btc': {
    pair: 'BTC/USDC',
    side: 'sell',
    quantity: 2,
    price: 80_000,
    expectedNotional: 160_000,
    expectedUsedCredit: 1_260_000,
    expectedAvailableCredit: 740_000,
  },
  'step-blocked': {
    pair: 'BTC/USDC',
    side: 'buy',
    quantity: 10, // notional 800,000 but only 740,000 available → blocked
    price: 80_000,
    expectedNotional: 800_000,
    expectedUsedCredit: 1_260_000, // unchanged
    expectedAvailableCredit: 740_000, // unchanged
  },
};

/** Guided step metadata (UI presentation) */
export const GUIDED_STEPS: GuidedStep[] = [
  {
    key: 'step-buy-btc',
    title: 'Step 1 — Buy 10 BTC',
    description:
      'Execute a buy of 10 BTC at 80,000 USDC. Used credit will increase to 800,000 USDC.',
    screen: 'trading',
    requiredPersona: 'fund-trader',
  },
  {
    key: 'step-buy-eth',
    title: 'Step 2 — Buy 100 ETH',
    description:
      'Execute a buy of 100 ETH at 3,000 USDC. Used credit increases to 1,100,000 USDC.',
    screen: 'trading',
    requiredPersona: 'fund-trader',
  },
  {
    key: 'step-sell-btc',
    title: 'Step 3 — Sell 2 BTC',
    description:
      'Execute a sell of 2 BTC at 80,000 USDC. Credit used rises to 1,260,000 USDC (both directions consume credit).',
    screen: 'trading',
    requiredPersona: 'fund-trader',
  },
  {
    key: 'step-blocked',
    title: 'Step 4 — Blocked trade',
    description:
      'Attempt to buy 10 BTC (800,000 USDC required). Only 740,000 USDC is available. The trade is rejected.',
    screen: 'trading',
    requiredPersona: 'fund-trader',
  },
  {
    key: 'step-reminder',
    title: 'Step 5 — Settlement reminder appears',
    description:
      'Set the demo clock to one hour before the 17:00 UTC cutoff. The notification bell shows ' +
      '"3 unbatched trades need settlement today. Cutoff is 17:00 UTC." ' +
      'Click "Review trades" in the drawer to open Settlements → Trades with the filters already applied.',
    screen: 'trading',
    requiredPersona: 'fund-operations',
  },
  {
    key: 'step-settlements',
    title: 'Step 6 — Filtered trades view',
    description:
      'Settlements → Trades opened from the reminder: the Unbatched filter is active, the entity and ' +
      'counterparty are scoped, and the three relevant trades are highlighted.',
    screen: 'settlements',
    requiredPersona: 'fund-operations',
  },
  {
    key: 'step-batch',
    title: 'Step 7 — Create and submit batch',
    description:
      'Select the eligible trades and create the batch. ' +
      'Net obligations preview: pay 940,000 USDC; receive 8 BTC and 100 ETH. ' +
      'Submitting sends it for independent approval — one approver is required by Northstar Capital policy.',
    screen: 'settlements',
    requiredPersona: 'fund-operations',
  },
  {
    key: 'step-approve-reminder',
    title: 'Step 8 — Approval reminder',
    description:
      'Switch to Fund Approver. The bell now shows "Batch approval required" with the settlement due time. ' +
      'Fund Operations sees only "Awaiting approval from Alex Chen" — the submitter cannot approve their own batch.',
    screen: 'settlements',
    requiredPersona: 'fund-approver',
  },
  {
    key: 'step-approve',
    title: 'Step 9 — Approve batch',
    description:
      'Fund Approver reviews the net obligations and approves the batch. ' +
      'This records agreement on the amounts; it does not execute any payment.',
    screen: 'settlements',
    requiredPersona: 'fund-approver',
  },
  {
    key: 'step-payment-reminder',
    title: 'Step 10 — Payment-due reminder',
    description:
      'Back as Fund Operations, the bell shows "Payment due — 940,000.00 USDC remains outstanding" ' +
      'with the exact due time. The primary action opens the batch at the payment section.',
    screen: 'settlements',
    requiredPersona: 'fund-operations',
  },
  {
    key: 'step-pay-ref',
    title: 'Step 11 — Report a payment reference',
    description:
      'Report reference TXN-DEMO-001 against the USDC obligation. The reminder becomes ' +
      '"Payment reported — awaiting verification" and the "Make payment" action is withdrawn. ' +
      'A reported reference is not proof of receipt: nothing settles and no credit is released.',
    screen: 'settlements',
    requiredPersona: 'fund-operations',
  },
  {
    key: 'step-pay1',
    title: 'Step 12 — Verify 470,000 USDC',
    description:
      'Simulate verified receipt of the first partial USDC payment (470,000 USDC). ' +
      'The reminder becomes "Partial settlement" showing 470,000 of 940,000 verified.',
    screen: 'settlements',
    requiredPersona: 'fund-operations',
  },
  {
    key: 'step-pay2',
    title: 'Step 13 — Verify remaining 470,000 USDC',
    description:
      'Verify the remaining 470,000 USDC. Your pay side is complete, so the reminder becomes ' +
      '"Your payment is complete — waiting for Wintermute". You are not asked to pay again.',
    screen: 'settlements',
    requiredPersona: 'fund-operations',
  },
  {
    key: 'step-receive-btc',
    title: 'Step 14 — Verify receipt of 8 BTC',
    description:
      'Verify that 8 BTC have been received on the Bitcoin network. 100 ETH remains inbound.',
    screen: 'settlements',
    requiredPersona: 'fund-operations',
  },
  {
    key: 'step-receive-eth',
    title: 'Step 15 — Verify receipt of 100 ETH',
    description:
      'Verify receipt of 100 ETH. All obligations are now covered — the batch reconciles and settles ' +
      'automatically, active reminders clear into resolved history, and available credit is restored ' +
      'to 2,000,000 USDC.',
    screen: 'settlements',
    requiredPersona: 'fund-operations',
  },
  {
    key: 'step-done',
    title: 'Walkthrough complete',
    description:
      'Settlement complete. Credit returned to 2,000,000 USDC automatically. Open the bell to see ' +
      'active reminders cleared and the resolved history preserved.',
    screen: 'settlements',
  },
];

export function getStepByKey(key: GuidedStepKey): GuidedStep | undefined {
  return GUIDED_STEPS.find((s) => s.key === key);
}

export const GUIDED_STEP_ORDER: GuidedStepKey[] = GUIDED_STEPS.map((s) => s.key);

export function nextStepKey(current: GuidedStepKey): GuidedStepKey {
  const idx = GUIDED_STEP_ORDER.indexOf(current);
  if (idx === -1 || idx >= GUIDED_STEP_ORDER.length - 1) return 'step-done';
  return GUIDED_STEP_ORDER[idx + 1];
}
