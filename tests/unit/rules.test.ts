import {
  allowedVerifications,
  applicableRuleVersion,
  defaultTerms,
  describeGoal,
  diffRules,
  ruleChangeEffectiveDate,
  shortGoal,
  validateTerms,
  type ChallengeTerms,
  type RuleVersionLike,
} from '@/domain';

const today = '2026-11-10';

describe('defaults', () => {
  it('seven consecutive days starting tomorrow, all seven required', () => {
    const terms = defaultTerms('screen_time', today);
    expect(terms).toMatchObject({
      startDate: '2026-11-11',
      endDate: '2026-11-17',
      requiredDays: 7,
      target: 120,
      comparator: 'lte',
      verification: 'evidence',
      metricUnit: 'minutes',
    });
    expect(validateTerms(terms, { today, phase: 'publish' })).toEqual([]);
  });

  it('seeds each habit with its default target', () => {
    expect(defaultTerms('reading', today)).toMatchObject({ target: 20, comparator: 'gte', verification: 'self_report' });
    expect(defaultTerms('pushups', today)).toMatchObject({ target: 50, comparator: 'gte', metricUnit: 'reps' });
    expect(defaultTerms('prayer', today)).toMatchObject({ target: 1, comparator: 'bool', verification: 'self_report' });
    expect(defaultTerms('custom', today)).toMatchObject({ target: 1, comparator: 'bool' });
  });
});

describe('validation', () => {
  const base: ChallengeTerms = defaultTerms('screen_time', today);
  const fields = (terms: ChallengeTerms, ctx: Parameters<typeof validateTerms>[1] = { today, phase: 'publish' }) =>
    validateTerms(terms, ctx).map((issue) => issue.field);

  it('screen time can never be self-reported', () => {
    expect(allowedVerifications('screen_time')).toEqual(['evidence']);
    expect(fields({ ...base, verification: 'self_report' })).toContain('verification');
  });

  it('other habits may be self-reported or require proof', () => {
    expect(allowedVerifications('reading')).toEqual(['self_report', 'evidence']);
    expect(fields({ ...defaultTerms('pushups', today), verification: 'evidence' })).toEqual([]);
  });

  it('allows 1 to 30 days', () => {
    expect(fields({ ...base, endDate: base.startDate, requiredDays: 1 })).toEqual([]);
    expect(fields({ ...base, endDate: '2026-12-10', requiredDays: 30 })).toEqual([]);
    expect(fields({ ...base, endDate: '2026-12-11', requiredDays: 30 })).toContain('endDate');
    expect(fields({ ...base, endDate: '2026-11-10' })).toContain('endDate');
  });

  it('required days must be between 1 and the duration', () => {
    expect(fields({ ...base, requiredDays: 0 })).toContain('requiredDays');
    expect(fields({ ...base, requiredDays: 8 })).toContain('requiredDays');
    expect(fields({ ...base, requiredDays: 5 })).toEqual([]);
  });

  it('a new challenge has to start tomorrow or later', () => {
    expect(fields({ ...base, startDate: today, endDate: '2026-11-16' })).toContain('startDate');
    expect(fields({ ...base, startDate: '2026-11-09', endDate: '2026-11-15' })).toContain('startDate');
  });

  it('checks targets and units', () => {
    expect(fields({ ...base, target: 0 })).toContain('target');
    expect(fields({ ...base, target: 5000 })).toContain('target');
    expect(fields({ ...defaultTerms('prayer', today), target: 2 })).toContain('target');
    expect(fields({ ...defaultTerms('custom', today), comparator: 'gte', target: 8, metricUnit: '' })).toContain('metricUnit');
    expect(fields({ ...defaultTerms('custom', today), comparator: 'gte', target: 8, metricUnit: 'glasses' })).toEqual([]);
    expect(fields({ ...defaultTerms('custom', today), comparator: 'lte', target: 8, metricUnit: 'glasses' })).toContain('comparator');
  });

  it('after the start, the start date is fixed and the end must leave a next day', () => {
    const started = { today: '2026-11-13', phase: 'change' as const, started: true, currentStartDate: base.startDate };
    expect(fields({ ...base, target: 90 }, started)).toEqual([]);
    expect(fields({ ...base, startDate: '2026-11-12' }, started)).toContain('startDate');
    expect(fields({ ...base, endDate: '2026-11-13', requiredDays: 3 }, started)).toContain('endDate');
    expect(fields({ ...base, endDate: '2026-11-14', requiredDays: 4 }, started)).toEqual([]);
  });
});

describe('rule versions', () => {
  const v = (version: number, status: RuleVersionLike['status'], effectiveDate: string, target: number): RuleVersionLike => ({
    id: `v${version}`,
    version,
    status,
    effectiveDate,
    target,
    comparator: 'lte',
    requiredDays: 7,
    verification: 'evidence',
    startDate: '2026-11-03',
    endDate: '2026-11-09',
  });

  it('historical days keep the version they ran under', () => {
    const versions = [v(1, 'superseded', '2026-11-03', 120), v(2, 'active', '2026-11-07', 90)];
    expect(applicableRuleVersion(versions, '2026-11-03')?.id).toBe('v1');
    expect(applicableRuleVersion(versions, '2026-11-06')?.id).toBe('v1');
    expect(applicableRuleVersion(versions, '2026-11-07')?.id).toBe('v2');
    expect(applicableRuleVersion(versions, '2026-11-09')?.id).toBe('v2');
  });

  it('ignores proposals, declined and withdrawn versions', () => {
    const versions = [
      v(1, 'active', '2026-11-03', 120),
      v(2, 'declined', '2026-11-05', 60),
      v(3, 'proposed', '2026-11-06', 90),
      v(4, 'withdrawn', '2026-11-06', 30),
    ];
    expect(applicableRuleVersion(versions, '2026-11-08')?.id).toBe('v1');
  });

  it('a change accepted before the start replaces the rules for every day', () => {
    // v2 moved the start earlier than v1's effective date; the newer version still governs.
    const versions = [v(1, 'superseded', '2026-11-05', 120), v(2, 'active', '2026-11-03', 90)];
    expect(applicableRuleVersion(versions, '2026-11-03')?.id).toBe('v2');
    expect(applicableRuleVersion(versions, '2026-11-06')?.id).toBe('v2');
  });

  it('two changes effective the same day resolve to the newer version', () => {
    const versions = [v(1, 'superseded', '2026-11-03', 120), v(2, 'superseded', '2026-11-06', 100), v(3, 'active', '2026-11-06', 90)];
    expect(applicableRuleVersion(versions, '2026-11-06')?.id).toBe('v3');
    expect(applicableRuleVersion(versions, '2026-11-05')?.id).toBe('v1');
  });

  it('new rules apply from the next challenge day after acceptance', () => {
    expect(ruleChangeEffectiveDate('2026-11-05', '2026-11-03')).toBe('2026-11-06');
    // Not started yet: the change applies from the first day.
    expect(ruleChangeEffectiveDate('2026-11-01', '2026-11-03')).toBe('2026-11-03');
    expect(ruleChangeEffectiveDate('2026-11-02', '2026-11-03')).toBe('2026-11-03');
  });

  it('lists changed fields for the before/after preview', () => {
    const before = v(1, 'active', '2026-11-03', 120);
    expect(diffRules(before, { ...before, target: 90, requiredDays: 5 })).toEqual(['target', 'requiredDays']);
    expect(diffRules(before, { ...before })).toEqual([]);
  });
});

describe('goal copy', () => {
  it('uses inclusive wording for maximum goals', () => {
    expect(describeGoal('screen_time', 'lte', 120, 'minutes')).toBe('2 hours or less of screen time a day');
    expect(describeGoal('screen_time', 'lte', 90, 'minutes')).toBe('1 hour 30 minutes or less of screen time a day');
    expect(shortGoal('screen_time', 'lte', 120, 'minutes')).toBe('2h or less a day');
  });

  it('describes minimum and yes/no goals', () => {
    expect(describeGoal('reading', 'gte', 20, 'minutes')).toBe('Read at least 20 minutes a day');
    expect(describeGoal('pushups', 'gte', 50, 'reps')).toBe('At least 50 reps a day');
    expect(describeGoal('prayer', 'bool', 1, 'check-in')).toBe('Pray once a day');
    expect(describeGoal('custom', 'gte', 8, 'glasses')).toBe('At least 8 glasses a day');
    expect(shortGoal('custom', 'bool', 1, 'check-in')).toBe('Daily check-in');
  });
});
