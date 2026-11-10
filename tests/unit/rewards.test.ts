import { computeRewardPreview, formatBps, formatCents, DisabledPaymentProvider, ILLUSTRATIVE_FEE_BPS } from '@/domain';

describe('reward preview (demo only)', () => {
  it('computes total, fee, net and equal shares in integer cents', () => {
    const preview = computeRewardPreview({
      mode: 'demo_sponsor',
      grossCents: 100_00,
      feeBps: ILLUSTRATIVE_FEE_BPS,
      qualifierIds: ['p2', 'p1'],
    });
    expect(preview).toMatchObject({
      currency: 'USD',
      grossCents: 10000,
      feeCents: 500,
      netCents: 9500,
      eligibleFinishers: 2,
      state: 'allocated',
      refundCents: 0,
    });
    expect(preview.allocations).toEqual([
      { participantId: 'p1', cents: 4750 },
      { participantId: 'p2', cents: 4750 },
    ]);
  });

  it('hands leftover cents out deterministically by participant ID', () => {
    const input = { mode: 'demo_pot' as const, grossCents: 100_00, feeBps: 500, qualifierIds: ['c', 'a', 'b'] };
    const preview = computeRewardPreview(input);
    // 9500 / 3 = 3166 remainder 2: the first two IDs get one extra cent.
    expect(preview.allocations).toEqual([
      { participantId: 'a', cents: 3167 },
      { participantId: 'b', cents: 3167 },
      { participantId: 'c', cents: 3166 },
    ]);
    expect(preview.allocations.reduce((sum, a) => sum + a.cents, 0)).toBe(preview.netCents);
    // Input order never changes the result.
    expect(computeRewardPreview({ ...input, qualifierIds: ['b', 'c', 'a'] })).toEqual(preview);
  });

  it('never loses or creates a cent', () => {
    for (const grossCents of [1, 99, 100, 101, 3333, 10_000, 12_345, 99_999]) {
      for (const feeBps of [0, 250, 500, 999]) {
        for (let n = 1; n <= 7; n += 1) {
          const qualifierIds = Array.from({ length: n }, (_, i) => `p${i}`);
          const preview = computeRewardPreview({ mode: 'demo_sponsor', grossCents, feeBps, qualifierIds });
          const paid = preview.allocations.reduce((sum, a) => sum + a.cents, 0);
          expect(paid + preview.feeCents).toBe(grossCents);
          expect(preview.allocations.every((a) => Number.isInteger(a.cents) && a.cents >= 0)).toBe(true);
          const amounts = preview.allocations.map((a) => a.cents);
          expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('zero qualifiers is a simulated refund, never a division by zero', () => {
    const preview = computeRewardPreview({ mode: 'demo_sponsor', grossCents: 100_00, feeBps: 500, qualifierIds: [] });
    expect(preview).toMatchObject({ state: 'refund_simulated', refundCents: 10000, feeCents: 0, netCents: 0, eligibleFinishers: 0 });
    expect(preview.allocations).toEqual([]);
  });

  it('no reward mode produces nothing', () => {
    expect(computeRewardPreview({ mode: 'none', grossCents: 0, feeBps: 0, qualifierIds: ['a'] })).toMatchObject({
      state: 'none',
      allocations: [],
      netCents: 0,
    });
  });

  it('counts each finisher once', () => {
    const preview = computeRewardPreview({ mode: 'demo_sponsor', grossCents: 1000, feeBps: 0, qualifierIds: ['a', 'a', 'b'] });
    expect(preview.eligibleFinishers).toBe(2);
    expect(preview.allocations).toEqual([
      { participantId: 'a', cents: 500 },
      { participantId: 'b', cents: 500 },
    ]);
  });

  it('rejects fractional cents and out-of-range fees', () => {
    expect(() => computeRewardPreview({ mode: 'demo_sponsor', grossCents: 10.5, feeBps: 500, qualifierIds: [] })).toThrow(RangeError);
    expect(() => computeRewardPreview({ mode: 'demo_sponsor', grossCents: -1, feeBps: 500, qualifierIds: [] })).toThrow(RangeError);
    expect(() => computeRewardPreview({ mode: 'demo_sponsor', grossCents: 100, feeBps: 5000, qualifierIds: [] })).toThrow(RangeError);
  });

  it('formats money from cents', () => {
    expect(formatCents(10000)).toBe('$100');
    expect(formatCents(3167)).toBe('$31.67');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123456700)).toBe('$1,234,567');
    expect(formatBps(500)).toBe('5%');
    expect(formatBps(250)).toBe('2.5%');
  });

  it('the only payment provider is disabled', async () => {
    expect(DisabledPaymentProvider.live).toBe(false);
    await expect(DisabledPaymentProvider.beginFunding({ challengeId: 'c', grossCents: 100 })).rejects.toThrow('LIVE_PAYMENTS_DISABLED');
  });
});
