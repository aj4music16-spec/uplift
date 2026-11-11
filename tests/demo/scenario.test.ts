import { createDemo, type Demo } from '@/data/demo/createDemo';
import type { PersonKey } from '@/data/scenario/innerCircle';
import type { ChallengeDetail } from '@/data/types';
import { addDays, computeRewardPreview } from '@/domain';

/**
 * The sample data is a replay, so every score must be reproducible from the
 * records. These tests pin the fixture states the specification asks for.
 */
describe('The Inner Circle sample data', () => {
  const TZ = 'America/New_York';
  const NOW = new Date('2026-11-10T20:30:00Z'); // 3:30 pm local; the demo clock still lands on 9:00 am
  const TODAY = '2026-11-10';
  let demo: Demo;
  let screenTime: ChallengeDetail;
  const as = (person: PersonKey) => demo.repositoryFor(person);
  const row = (detail: ChallengeDetail, person: PersonKey) => detail.standings.find((s) => s.person.userId === demo.scenario.people[person].id)!;

  beforeAll(async () => {
    demo = await createDemo({ timeZone: TZ, now: NOW });
    screenTime = await as('aj').getChallenge(demo.scenario.challenges.screenTime);
  });

  it('ends at nine in the morning of the current day, whatever time it is opened', () => {
    expect(demo.backend.clock.now().toISOString().slice(0, 16)).toBe('2026-11-10T14:00');
  });

  it('has six synthetic members and an empty second Circle', async () => {
    const home = await as('aj').getHome();
    expect(home.circles.map((c) => [c.name, c.memberCount])).toEqual([
      ['The Inner Circle', 6],
      ['Weekend Hikers', 1],
    ]);
    const circle = await as('aj').getCircle(demo.scenario.circleId);
    expect(circle.members.map((m) => [m.displayName, m.role])).toEqual([
      ['AJ', 'owner'],
      ['Dad', 'admin'],
      ['Ben', 'member'],
      ['Kaan', 'member'],
      ['Mia', 'member'],
      ['Leo', 'member'],
    ]);
    const empty = await as('aj').getCircle(demo.scenario.emptyCircleId);
    expect(empty.challenges).toEqual([]);
  });

  it('Screen Time Showdown: seven days, 2 hours or less, standings derived from records', () => {
    expect(screenTime).toMatchObject({ status: 'active', startDate: addDays(TODAY, -5), endDate: addDays(TODAY, 1), habitType: 'screen_time' });
    expect(screenTime.rules).toMatchObject({ target: 120, comparator: 'lte', verification: 'evidence', requiredDays: 5 });
    expect(screenTime.standings.map((s) => [s.person.displayName, s.successfulDays, s.pendingDays, s.rank, s.tied])).toEqual([
      ['AJ', 4, 0, 1, true],
      ['Ben', 4, 1, 1, true],
      ['Dad', 4, 0, 1, true],
      ['Kaan', 3, 1, 4, false],
      ['Mia', 2, 1, 5, true],
      ['Leo', 2, 0, 5, true],
    ]);
    expect(screenTime.admins.map((p) => p.displayName)).toEqual(['AJ', 'Dad']);
  });

  it('covers pending, accepted, rejected, late, missing and admin-adjusted days', async () => {
    const statuses = (person: PersonKey) => row(screenTime, person).days.map((d) => d.status);
    // AJ is an admin, so these are true statuses.
    expect(statuses('aj')).toEqual(['success', 'success', 'success', 'success', 'due', 'open', 'upcoming']);
    expect(statuses('ben')).toEqual(['success', 'success', 'success', 'success', 'pending', 'open', 'upcoming']);
    expect(statuses('kaan')).toEqual(['success', 'fail', 'success', 'success', 'pending', 'open', 'upcoming']);
    expect(statuses('dad')).toEqual(['success', 'success', 'success', 'success', 'due', 'open', 'upcoming']);
    expect(statuses('mia')).toEqual(['success', 'success', 'fail', 'missed', 'pending', 'open', 'upcoming']);
    expect(statuses('leo')).toEqual(['missed', 'success', 'success', 'rejected', 'due', 'open', 'upcoming']);
    expect(row(screenTime, 'dad').days[3]).toMatchObject({ status: 'success', adjusted: true });

    // Exactly on the limit counts.
    const ajDay3 = await as('aj').getDay({ challengeId: screenTime.id, date: addDays(TODAY, -3) });
    expect(ajDay3.record).toMatchObject({ effectiveValue: 120, outcome: 'success', provenance: 'evidence_reviewed' });
    // Over the limit with valid evidence is a verified failed day.
    const kaanDay2 = await as('kaan').getDay({ challengeId: screenTime.id, date: addDays(TODAY, -4) });
    expect(kaanDay2.record).toMatchObject({ effectiveValue: 150, outcome: 'fail', provenance: 'evidence_reviewed' });
    // An admin who reviewed their own proof is labeled.
    const dadDay3 = await as('dad').getDay({ challengeId: screenTime.id, date: addDays(TODAY, -3) });
    expect(dadDay3.record?.provenance).toBe('admin_self_reviewed');
    // A late submission that an admin accepted, then reviewed.
    const leoDay3 = await as('leo').getDay({ challengeId: screenTime.id, date: addDays(TODAY, -3) });
    expect(leoDay3.submissions[0]).toMatchObject({ isLate: true, status: 'accepted' });
    expect(leoDay3.submissions[0]?.reviews.map((r) => r.decision)).toEqual(['late_accepted', 'approved']);
    // A rejected screenshot that was resubmitted keeps its history.
    const miaDay2 = await as('mia').getDay({ challengeId: screenTime.id, date: addDays(TODAY, -4) });
    expect(miaDay2.submissions.map((s) => [s.version, s.status])).toEqual([
      [2, 'accepted'],
      [1, 'rejected'],
    ]);
    // The manual correction carries its reason.
    const dadDay4 = await as('dad').getDay({ challengeId: screenTime.id, date: addDays(TODAY, -2) });
    expect(dadDay4.record?.provenance).toBe('admin_adjusted');
    expect(dadDay4.overrides[0]).toMatchObject({ priorOutcome: 'missed', newOutcome: 'success', reason: 'He showed me his phone at dinner: 1h 10m.' });
  });

  it('other players never see that someone’s proof was rejected', async () => {
    const seenByBen = await as('ben').getChallenge(screenTime.id);
    // Leo's rejected day reads as still waiting for a submission.
    expect(row(seenByBen, 'leo').days[3]?.status).toBe('due');
    // And nobody sees other people's values.
    expect(row(seenByBen, 'leo').days.every((d) => d.value === null)).toBe(true);
    expect(row(seenByBen, 'ben').days[0]?.value).toBe(100);
    // The rejection reason is in Leo's history but not in Ben's.
    const forBen = await as('ben').listAudit({ challengeId: screenTime.id, limit: 100 });
    expect(forBen.items.some((e) => e.action === 'review.rejected')).toBe(false);
    const forLeo = await as('leo').listAudit({ challengeId: screenTime.id, limit: 100 });
    expect(forLeo.items.some((e) => e.action === 'review.rejected' && e.reason?.includes('weekly view'))).toBe(true);
    // Everyone can see the admin's correction and why.
    expect(forBen.items.some((e) => e.action === 'day.overridden' && e.reason?.includes('dinner'))).toBe(true);
  });

  it('has a review queue with three screenshots and one open dispute', async () => {
    const queue = await as('aj').getReviewQueue(screenTime.id);
    expect(queue.items.map((i) => [i.person.displayName, i.enteredValue, i.kind])).toEqual([
      ['Ben', 85, 'review'],
      ['Kaan', 96, 'review'],
      ['Mia', 100, 'review'],
    ]);
    expect(queue.disputes.map((d) => [d.person.displayName, d.reason])).toEqual([['Mia', 'That total includes my iPad. Phone only was 1h 55m.']]);
    expect(screenTime.pendingReviewCount).toBe(3);
    expect(screenTime.openDisputeCount).toBe(1);
  });

  it('Pushup Club shows partial progress and a rule change waiting for AJ', async () => {
    const pushups = await as('aj').getChallenge(demo.scenario.challenges.pushups);
    expect(pushups.rules).toMatchObject({ target: 50, comparator: 'gte', verification: 'self_report' });
    const today = pushups.myDays.find((d) => d.date === TODAY);
    expect(today).toMatchObject({ status: 'open', value: 30 });
    expect(pushups.viewer.successfulDays).toBe(2);
    expect(pushups.proposalAwaitingMe).toBe(true);
    expect(pushups.proposal?.version.target).toBe(40);
    expect(pushups.proposal?.responses.map((r) => [r.person.displayName, r.decision])).toEqual([
      ['Ben', 'accepted'],
      ['AJ', 'pending'],
      ['Kaan', 'accepted'],
      ['Leo', 'accepted'],
    ]);
    // Leo did 30 of 50 on day one: a missed day, never counted.
    expect(row(pushups, 'leo').successfulDays).toBe(1);
  });

  it('has reading, prayer, a scheduled challenge, a draft and a completed one', async () => {
    const reading = await as('aj').getChallenge(demo.scenario.challenges.reading);
    expect(reading.standings.map((s) => [s.person.displayName, s.successfulDays])).toEqual([
      ['Mia', 3],
      ['AJ', 3],
      ['Dad', 2],
    ]);
    const prayer = await as('aj').getChallenge(demo.scenario.challenges.prayer);
    expect(prayer.habitType).toBe('prayer');
    expect(row(prayer, 'aj').successfulDays).toBe(3);
    expect(row(prayer, 'dad').successfulDays).toBe(5);

    const scheduled = await as('aj').getChallenge(demo.scenario.challenges.scheduled);
    expect(scheduled).toMatchObject({ status: 'scheduled', participantCount: 2 });
    expect(scheduled.viewer.participantId).toBeNull();

    const draft = await as('aj').getChallenge(demo.scenario.challenges.draft);
    expect(draft).toMatchObject({ status: 'draft', draftStep: 3, name: 'Weekend Reading Sprint' });
    // Drafts are private to their admin.
    await expect(as('ben').getChallenge(demo.scenario.challenges.draft)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const completed = await as('aj').getChallenge(demo.scenario.challenges.completed);
    expect(completed.status).toBe('completed');
    expect(completed.standings.map((s) => [s.person.displayName, s.successfulDays, s.rank, s.tied, s.qualified])).toEqual([
      ['AJ', 3, 1, true, true],
      ['Ben', 3, 1, true, true],
      ['Kaan', 2, 3, true, false],
      ['Mia', 2, 3, true, false],
    ]);
  });

  it('carries a simulated sponsored reward, demo only', () => {
    expect(screenTime.rewardMode).toBe('demo_sponsor');
    expect(screenTime.reward).toMatchObject({ grossCents: 10000, feeBps: 500, demoOnly: true, currency: 'USD' });
    expect(screenTime.reward?.sponsor?.displayName).toBe('Dad');
    const preview = computeRewardPreview({
      mode: 'demo_sponsor',
      grossCents: screenTime.reward!.grossCents,
      feeBps: screenTime.reward!.feeBps,
      qualifierIds: screenTime.standings.filter((s) => s.qualified).map((s) => s.participantId),
    });
    // Nobody has five successful days yet, so the preview is a simulated refund, not a payout.
    expect(preview.state).toBe('refund_simulated');
  });

  it('gives AJ a home screen with real things to do', async () => {
    const home = await as('aj').getHome();
    expect(home.challenges.map((c) => [c.name, c.status])).toEqual(
      expect.arrayContaining([
        ['Screen Time Showdown', 'active'],
        ['Pushup Club', 'active'],
        ['The 20-minute Club', 'active'],
        ['Daily Prayer', 'active'],
        ['Cold Shower Week', 'scheduled'],
        ['Weekend Reading Sprint', 'draft'],
      ]),
    );
    expect(home.unreadNotifications).toBeGreaterThan(0);
    const chat = await as('aj').listMessages({ circleId: demo.scenario.circleId, limit: 100 });
    expect(chat.items.filter((m) => m.kind === 'user').map((m) => m.text)).toEqual([
      'That prize is still up for grabs.',
      'Already checked in.',
      'Who is actually staying under 2 hours today?',
    ]);
  });

  it('is deterministic: two replays produce the same standings', async () => {
    const again = await createDemo({ timeZone: TZ, now: NOW });
    const other = await again.repositoryFor('aj').getChallenge(again.scenario.challenges.screenTime);
    expect(other.standings.map((s) => [s.person.displayName, s.successfulDays, s.pendingDays, s.rank])).toEqual(
      screenTime.standings.map((s) => [s.person.displayName, s.successfulDays, s.pendingDays, s.rank]),
    );
  });
});
