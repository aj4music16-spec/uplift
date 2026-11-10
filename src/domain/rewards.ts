import type { RewardMode } from './types';

/**
 * Reward previews are a DEMO ONLY illustration. Uplift does not collect, hold
 * or pay out money, and nothing computed here is withdrawable. All arithmetic
 * is in integer cents, one currency (USD).
 */

export const REWARD_CURRENCY = 'USD';
/** 5%, shown as "Illustrative fee, not final pricing". No rate has been approved. */
export const ILLUSTRATIVE_FEE_BPS = 500;
export const MAX_FEE_BPS = 2000;
export const MAX_GROSS_CENTS = 1_000_000_00;

export const DEMO_REWARD_LABEL = 'Demo reward — no money collected';
export const ILLUSTRATIVE_FEE_LABEL = 'Illustrative fee, not final pricing';
export const SPLIT_METHOD_LABEL =
  'Split equally in whole cents. Leftover cents go one each to finishers in a fixed order (by participant ID).';

export interface RewardPreviewInput {
  mode: RewardMode;
  /** Total simulated amount in cents. */
  grossCents: number;
  /** Illustrative fee in basis points (1/100 of a percent). */
  feeBps: number;
  /** Stable participant IDs of everyone who reached the required days. */
  qualifierIds: readonly string[];
}

export interface RewardAllocation {
  participantId: string;
  cents: number;
}

export interface RewardPreview {
  mode: RewardMode;
  currency: typeof REWARD_CURRENCY;
  grossCents: number;
  feeBps: number;
  feeCents: number;
  netCents: number;
  eligibleFinishers: number;
  /** allocated: split among finishers. refund_simulated: nobody qualified, the whole amount is shown going back. */
  state: 'none' | 'allocated' | 'refund_simulated';
  allocations: RewardAllocation[];
  /** Cents shown returning to the funder(s) when nobody qualifies. No fee is shown on a refund. */
  refundCents: number;
}

function assertCents(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer number of cents`);
}

/**
 * The single shared function for reward preview arithmetic: total, fee, net,
 * eligible finishers and per-person allocation.
 *
 *  - fee = floor(gross * feeBps / 10000)
 *  - net = gross - fee, split equally in whole cents
 *  - leftover cents are handed out one each in ascending participant-ID order
 *  - zero qualifiers is a simulated refund, never a division by zero
 */
export function computeRewardPreview(input: RewardPreviewInput): RewardPreview {
  assertCents(input.grossCents, 'grossCents');
  if (!Number.isInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > MAX_FEE_BPS) {
    throw new RangeError(`feeBps must be an integer between 0 and ${MAX_FEE_BPS}`);
  }
  if (input.grossCents > MAX_GROSS_CENTS) throw new RangeError('grossCents is above the preview maximum');

  const base = {
    mode: input.mode,
    currency: REWARD_CURRENCY,
    grossCents: input.grossCents,
    feeBps: input.feeBps,
  } as const;

  if (input.mode === 'none' || input.grossCents === 0) {
    return { ...base, feeCents: 0, netCents: 0, eligibleFinishers: 0, state: 'none', allocations: [], refundCents: 0 };
  }

  const ids = [...new Set(input.qualifierIds)].sort();
  if (ids.length === 0) {
    return {
      ...base,
      feeCents: 0,
      netCents: 0,
      eligibleFinishers: 0,
      state: 'refund_simulated',
      allocations: [],
      refundCents: input.grossCents,
    };
  }

  // Integer math only. gross <= 1e8 and feeBps <= 2000 keeps the product far below 2^53.
  const feeCents = Math.floor((input.grossCents * input.feeBps) / 10_000);
  const netCents = input.grossCents - feeCents;
  const share = Math.floor(netCents / ids.length);
  const leftover = netCents - share * ids.length;
  const allocations = ids.map((participantId, index) => ({
    participantId,
    cents: share + (index < leftover ? 1 : 0),
  }));
  return { ...base, feeCents, netCents, eligibleFinishers: ids.length, state: 'allocated', allocations, refundCents: 0 };
}

/** "$100", "$33.34". Always from integer cents. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const whole = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest === 0 ? `${sign}$${whole}` : `${sign}$${whole}.${String(rest).padStart(2, '0')}`;
}

export function formatBps(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, '')}%`;
}

/**
 * Boundary for a future real payment provider. Nothing implements live
 * collection: the only provider is the disabled one below, and the server
 * refuses any reward state that is not a demo preview.
 */
export interface PaymentProvider {
  readonly id: string;
  readonly live: boolean;
  /** Always rejects in this build. Present so future work has one seam to implement. */
  beginFunding(input: { challengeId: string; grossCents: number }): Promise<never>;
}

export const DisabledPaymentProvider: PaymentProvider = {
  id: 'disabled',
  live: false,
  beginFunding() {
    return Promise.reject(new Error('LIVE_PAYMENTS_DISABLED'));
  },
};
