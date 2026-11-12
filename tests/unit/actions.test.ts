import type { ChallengeCard, DayCell } from '@/data/types';
import { addDays, dateKeyAt, dayWindow } from '@/domain';
import { deriveActions, groupChallenges } from '@/features/challenges/actions';

const TZ = 'America/New_York';
const TODAY = '2026-11-10';
// 9:00 am local on TODAY: yesterday is over, its deadline (noon today) is still ahead.
const NOW = new Date('2026-11-10T14:00:00Z');

function card(overrides: Partial<ChallengeCard> & { days?: DayCell[] } = {}): ChallengeCard {
  const { days, ...rest } = overrides;
  const base: ChallengeCard = {
    id: 'c1',
    circleId: 'circle',
    circleName: 'The Inner Circle',
    name: 'Screen Time Showdown',
    description: '',
    habitType: 'screen_time',
    metricUnit: 'minutes',
    timezone: TZ,
    status: 'active',
    startDate: addDays(TODAY, -5),
    endDate: addDays(TODAY, 1),
    revision: 1,
    rules: {
      id: 'r1',
      version: 1,
      status: 'active',
      target: 120,
      comparator: 'lte',
      requiredDays: 5,
      verification: 'evidence',
      startDate: addDays(TODAY, -5),
      endDate: addDays(TODAY, 1),
      effectiveDate: addDays(TODAY, -5),
    },
    rewardMode: 'none',
    participantCount: 6,
    participants: [],
    viewer: {
      isAdmin: false,
      isCircleAdmin: false,
      participantId: 'p1',
      removed: false,
      successfulDays: 0,
      pendingDays: 0,
      rank: null,
      tied: false,
      qualified: false,
    },
    myDays: days ?? [],
    pendingReviewCount: 0,
    openDisputeCount: 0,
    proposalAwaitingMe: false,
    readyToFinalize: false,
    draftStep: 1,
    updatedAt: NOW.toISOString(),
  };
  return { ...base, ...rest };
}

const day = (date: string, status: DayCell['status'], value: number | null = null): DayCell => ({ date, status, adjusted: false, value });

describe('deriveActions', () => {
  it('asks for yesterday’s screenshot, never today’s', () => {
    const actions = deriveActions([card({ days: [day(addDays(TODAY, -1), 'due'), day(TODAY, 'open'), day(addDays(TODAY, 1), 'upcoming')] })], NOW);
    expect(actions.map((a) => a.title)).toEqual(['Submit yesterday’s screenshot']);
    expect(actions[0]).toMatchObject({ kind: 'due', urgent: true, href: `/challenge/c1/checkin?date=${addDays(TODAY, -1)}` });
    expect(actions[0]?.subtitle).toContain('Due');
  });

  it('never emits a screen-time prompt for a day that has not ended, even if marked due', () => {
    // A stale or wrong "due" for today must still be ignored until midnight.
    const actions = deriveActions([card({ days: [day(TODAY, 'due'), day(TODAY, 'open')] })], NOW);
    expect(actions).toEqual([]);
    const lateEvening = dayWindow(TODAY, TZ).endsAt.getTime() - 60_000;
    expect(deriveActions([card({ days: [day(TODAY, 'due')] })], new Date(lateEvening))).toEqual([]);
  });

  it('orders due days by soonest deadline and puts rejected proof first', () => {
    const older = card({ id: 'a', days: [day(addDays(TODAY, -1), 'due')] });
    const reading = card({
      id: 'b',
      name: 'Reading',
      habitType: 'reading',
      days: [day(addDays(TODAY, -1), 'due')],
    });
    // A challenge further west has a later noon deadline for the same date, so it comes after New York.
    const chicagoToday = dateKeyAt(NOW, 'America/Chicago');
    const west = card({ id: 'c', timezone: 'America/Chicago', days: [day(addDays(chicagoToday, -1), 'due')] });
    const rejected = card({ id: 'd', days: [day(addDays(TODAY, -2), 'rejected')] });
    const actions = deriveActions([west, older, reading, rejected], NOW).filter((a) => a.kind === 'due' || a.kind === 'resubmit');
    expect(actions[0]).toMatchObject({ kind: 'resubmit', challengeId: 'd' });
    expect(actions.slice(1).map((a) => a.challengeId)).toEqual(['a', 'b', 'c']);
    expect(actions.find((a) => a.challengeId === 'b')?.title).toBe('Log yesterday’s reading');
  });

  it('shows the admin review count and disputes', () => {
    const actions = deriveActions(
      [card({ viewer: { ...card().viewer, isAdmin: true }, pendingReviewCount: 3, openDisputeCount: 1, days: [] })],
      NOW,
    );
    expect(actions.map((a) => [a.title, a.href])).toEqual([
      ['Review 3 submissions', '/challenge/c1/review'],
      ['Resolve a dispute', '/challenge/c1/review'],
    ]);
  });

  it('pending days produce no action', () => {
    const actions = deriveActions(
      [card({ days: [day(addDays(TODAY, -2), 'pending'), day(addDays(TODAY, -1), 'late_pending'), day(addDays(TODAY, -3), 'success')] })],
      NOW,
    );
    expect(actions).toEqual([]);
  });

  it('prompts in-day logging for habits that do not need a finished day', () => {
    const pushups = card({ id: 'p', habitType: 'pushups', metricUnit: 'reps', rules: { ...card().rules, target: 50, comparator: 'gte', verification: 'self_report' }, days: [day(TODAY, 'open', 30)] });
    const prayer = card({ id: 'q', habitType: 'prayer', metricUnit: 'check-in', days: [day(TODAY, 'open')] });
    const actions = deriveActions([pushups, prayer], NOW);
    expect(actions.map((a) => a.title)).toEqual(['Log reps', 'Check in for today']);
    expect(actions[0]?.subtitle).toContain('30 / 50 today');
  });

  it('covers proposals, joining, finalizing and drafts in that order', () => {
    const actions = deriveActions(
      [
        card({ id: 'draft', status: 'draft', viewer: { ...card().viewer, isAdmin: true, participantId: null } }),
        card({ id: 'fin', status: 'review', readyToFinalize: true, viewer: { ...card().viewer, isAdmin: true } }),
        card({ id: 'join', status: 'scheduled', startDate: addDays(TODAY, 2), viewer: { ...card().viewer, participantId: null } }),
        card({ id: 'removed', status: 'scheduled', viewer: { ...card().viewer, participantId: null, removed: true } }),
        card({ id: 'prop', proposalAwaitingMe: true }),
      ],
      NOW,
    );
    expect(actions.map((a) => [a.kind, a.href])).toEqual([
      ['proposal', '/challenge/prop/rules'],
      ['join', '/challenge/join'],
      ['finalize', '/challenge/fin/results'],
      ['draft', '/challenge/new?draftId=draft'],
    ]);
  });

  it('ignores days of removed participants and closed challenges', () => {
    expect(deriveActions([card({ viewer: { ...card().viewer, removed: true }, days: [day(addDays(TODAY, -1), 'due')] })], NOW)).toEqual([]);
    expect(deriveActions([card({ status: 'completed', days: [day(addDays(TODAY, -1), 'rejected')] })], NOW)).toEqual([]);
  });
});

describe('groupChallenges', () => {
  it('groups live, scheduled, drafts and finished', () => {
    const groups = groupChallenges([
      card({ id: 'done', status: 'completed' }),
      card({ id: 'draft', status: 'draft' }),
      card({ id: 'soon', status: 'scheduled' }),
      card({ id: 'rev', status: 'review' }),
      card({ id: 'live', status: 'active' }),
    ]);
    expect(groups.live.map((c) => c.id)).toEqual(['live', 'rev']);
    expect(groups.scheduled.map((c) => c.id)).toEqual(['soon']);
    expect(groups.drafts.map((c) => c.id)).toEqual(['draft']);
    expect(groups.finished.map((c) => c.id)).toEqual(['done']);
  });
});
