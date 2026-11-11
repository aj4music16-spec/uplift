import type { AvatarSpec } from '@/components/Avatar';
import { addDays, zonedTimeToUtc, type DateKey } from '@/domain/time';

import type { Repository } from '../repository';
import type { DraftInput, LocalEvidence } from '../types';

/**
 * "The Inner Circle": the development sample data.
 *
 * It is not a table of hard-coded scores. It is a replay of everything six
 * synthetic people did over three weeks, performed through the public
 * Repository interface with a moving clock: publish, join, check in, review,
 * reject, resubmit, override, dispute, propose. Every number a screen shows is
 * therefore reproducible from the underlying records.
 *
 * The same replay seeds Demo Mode (DemoRepository) and a local Supabase stack
 * (scripts/seed-dev.mjs), which also makes it an end-to-end check of both.
 *
 * The people are invented. No credentials are created here.
 */

export type PersonKey = 'aj' | 'ben' | 'kaan' | 'dad' | 'mia' | 'leo';

export const PEOPLE: Record<PersonKey, { name: string; avatar: AvatarSpec }> = {
  aj: { name: 'AJ', avatar: { color: 'sun', face: 2 } },
  ben: { name: 'Ben', avatar: { color: 'coral', face: 1 } },
  kaan: { name: 'Kaan', avatar: { color: 'sky', face: 0 } },
  dad: { name: 'Dad', avatar: { color: 'mint', face: 4 } },
  mia: { name: 'Mia', avatar: { color: 'rose', face: 5 } },
  leo: { name: 'Leo', avatar: { color: 'iris', face: 3 } },
};

export interface EvidenceSpec {
  date: DateKey;
  minutes: number;
  /** day: a proper Day view. week: the weekly view (wrong). nodate: date cropped out (unreadable). */
  view?: 'day' | 'week' | 'nodate';
}

export interface ScenarioHarness {
  timeZone: string;
  /** The calendar date the replay ends on, in `timeZone`. */
  today: DateKey;
  createPerson(key: PersonKey, name: string, avatar: AvatarSpec): Promise<{ id: string; repo: Repository }>;
  setNow(instant: Date): Promise<void>;
  /** A synthetic screenshot for a date and total. */
  evidence(spec: EvidenceSpec): LocalEvidence;
}

export interface ScenarioResult {
  people: Record<PersonKey, { id: string; repo: Repository }>;
  circleId: string;
  emptyCircleId: string;
  challenges: {
    screenTime: string;
    pushups: string;
    reading: string;
    prayer: string;
    scheduled: string;
    draft: string;
    completed: string;
  };
}

export async function seedInnerCircle(h: ScenarioHarness): Promise<ScenarioResult> {
  const tz = h.timeZone;
  const day = (offset: number): DateKey => addDays(h.today, offset);
  const at = (offset: number, time: string): Date => {
    const [hour, minute] = time.split(':').map(Number);
    return zonedTimeToUtc(day(offset), hour ?? 0, minute ?? 0, tz);
  };

  let keyCounter = 0;
  const key = (prefix: string) => `seed-${prefix}-${String((keyCounter += 1)).padStart(5, '0')}`;

  const people = {} as ScenarioResult['people'];
  const P = (k: PersonKey): Repository => people[k].repo;

  /** Everything happens on one timeline, in order, with the clock set before each step. */
  const steps: { at: Date; order: number; run: () => Promise<unknown> }[] = [];
  const on = (offset: number, time: string, run: () => Promise<unknown>) => {
    steps.push({ at: at(offset, time), order: steps.length, run });
  };

  const ids = { circle: '', empty: '', screenTime: '', pushups: '', reading: '', prayer: '', scheduled: '', draft: '', completed: '' };

  const draft = (input: Omit<DraftInput, 'circleId' | 'timezone' | 'description' | 'draftStep'> & { description?: string }): DraftInput => ({
    circleId: ids.circle,
    timezone: tz,
    description: input.description ?? '',
    draftStep: 5,
    ...input,
  });

  const publish = async (who: PersonKey, input: DraftInput, joinAsParticipant = true): Promise<string> => {
    const created = await P(who).saveDraft(input);
    await P(who).publishChallenge({ challengeId: created.id, expectedRevision: created.revision, joinAsParticipant });
    return created.id;
  };

  const join = async (who: PersonKey, challengeId: string) => {
    const seen = await P(who).getChallenge(challengeId);
    await P(who).joinChallenge({ challengeId, acceptedVersionId: seen.rules.id });
  };

  const screenshot = (who: PersonKey, date: DateKey, minutes: number, view: EvidenceSpec['view'] = 'day', late = false) =>
    P(who).submitCheckin({
      challengeId: ids.screenTime,
      date,
      value: minutes,
      evidence: h.evidence({ date, minutes, view }),
      idempotencyKey: key(`st-${who}`),
      late,
    });

  /** An admin decides the waiting submission of a person for a date. */
  const review = async (
    admin: PersonKey,
    who: PersonKey,
    date: DateKey,
    decision: 'approve' | 'reject',
    options: { reason?: string; correctedValue?: number } = {},
  ) => {
    const queue = await P(admin).getReviewQueue(ids.screenTime);
    const item = queue.items.find((i) => i.person.userId === people[who].id && i.date === date && i.kind === 'review');
    if (!item) throw new Error(`Seed: no submission to review for ${who} on ${date}`);
    await P(admin).reviewSubmission({
      submissionId: item.submissionId,
      decision,
      reason: options.reason ?? null,
      correctedValue: options.correctedValue ?? null,
      expectedRevision: item.recordRevision,
    });
  };

  const selfReport = (who: PersonKey, challengeId: string, date: DateKey, value: number) =>
    P(who).submitCheckin({ challengeId, date, value, idempotencyKey: key(`sr-${who}`) });

  const reps = (who: PersonKey, date: DateKey, amount: number) =>
    P(who).addReps({ challengeId: ids.pushups, date, amount, idempotencyKey: key(`reps-${who}`) });

  /* ------------------------------------------------ three weeks ago: Circles */

  on(-21, '10:00', async () => {
    for (const k of Object.keys(PEOPLE) as PersonKey[]) {
      people[k] = await h.createPerson(k, PEOPLE[k].name, PEOPLE[k].avatar);
    }
    ids.circle = (await P('aj').createCircle({ name: 'The Inner Circle', timezone: tz })).id;
    const { code } = await P('aj').createInvite({ circleId: ids.circle, maxUses: 10 });
    for (const k of ['ben', 'kaan', 'dad', 'mia', 'leo'] as PersonKey[]) {
      await P(k).redeemInvite({ code, idempotencyKey: key(`join-${k}`) });
    }
    await P('aj').setMemberRole({ circleId: ids.circle, userId: people.dad.id, role: 'admin' });
    // A Circle with nothing in it yet.
    ids.empty = (await P('aj').createCircle({ name: 'Weekend Hikers', timezone: tz })).id;
  });

  /* ------------------------------------- a short challenge that has finished */

  on(-20, '12:00', async () => {
    ids.completed = await publish(
      'kaan',
      draft({
        name: 'Morning Miles',
        description: 'A walk before work. Two kilometres counts.',
        habitType: 'custom',
        metricUnit: 'km',
        target: 2,
        comparator: 'gte',
        requiredDays: 3,
        verification: 'self_report',
        startDate: day(-18),
        endDate: day(-16),
      }),
    );
    for (const k of ['aj', 'ben', 'mia'] as PersonKey[]) await join(k, ids.completed);
  });
  const miles: Record<string, (number | null)[]> = { aj: [2.5, 3, 2], ben: [2, 2.2, 4], kaan: [2, 1, 3], mia: [3, 2, null] };
  [-18, -17, -16].forEach((offset, index) => {
    on(offset, '20:00', async () => {
      for (const [who, values] of Object.entries(miles)) {
        const value = values[index];
        if (value != null) await selfReport(who as PersonKey, ids.completed, day(offset), value);
      }
    });
  });
  // After the last day's noon deadline nothing is pending, so it can complete.
  on(-15, '13:00', () => P('kaan').finalizeChallenge(ids.completed));

  /* ---------------------------------------------------- Screen Time Showdown */

  on(-8, '18:00', async () => {
    ids.screenTime = await publish(
      'aj',
      draft({
        name: 'Screen Time Showdown',
        description: 'Two hours or less on your phone, every day. Screenshot or it didn’t happen.',
        habitType: 'screen_time',
        metricUnit: 'minutes',
        target: 120,
        comparator: 'lte',
        requiredDays: 5,
        verification: 'evidence',
        startDate: day(-5),
        endDate: day(1),
      }),
    );
    // A second admin, appointed explicitly, so nobody has to review their own proof.
    await P('aj').assignChallengeAdmin({ challengeId: ids.screenTime, userId: people.dad.id });
  });
  on(-8, '19:00', async () => {
    // A simulated sponsored reward. Only possible where the demo flag allows it.
    await P('dad')
      .setRewardPreview({ challengeId: ids.screenTime, mode: 'demo_sponsor', grossCents: 100_00, feeBps: 500 })
      .catch(() => undefined);
  });
  on(-7, '09:00', async () => {
    for (const k of ['ben', 'kaan', 'dad', 'mia', 'leo'] as PersonKey[]) await join(k, ids.screenTime);
  });

  // Day 1 (five days ago). Proof is sent the next morning; Leo forgets.
  on(-4, '08:00', async () => {
    await screenshot('aj', day(-5), 95);
    await screenshot('ben', day(-5), 100);
    await screenshot('kaan', day(-5), 70);
    await screenshot('dad', day(-5), 60);
    await screenshot('mia', day(-5), 110);
  });
  on(-4, '09:30', async () => {
    await review('dad', 'aj', day(-5), 'approve');
    for (const k of ['ben', 'kaan', 'dad', 'mia'] as PersonKey[]) await review('aj', k, day(-5), 'approve');
  });

  // Day 2. Kaan is over the limit: valid evidence, failed day. Mia's first screenshot is unreadable.
  on(-3, '08:00', async () => {
    await screenshot('aj', day(-4), 110);
    await screenshot('ben', day(-4), 115);
    await screenshot('kaan', day(-4), 150);
    await screenshot('dad', day(-4), 90);
    await screenshot('mia', day(-4), 105, 'nodate');
    await screenshot('leo', day(-4), 100);
  });
  on(-3, '09:00', async () => {
    await review('dad', 'aj', day(-4), 'approve');
    for (const k of ['ben', 'kaan', 'dad', 'leo'] as PersonKey[]) await review('aj', k, day(-4), 'approve');
    await review('aj', 'mia', day(-4), 'reject', { reason: 'The date isn’t visible. Please send the Day view.' });
  });
  on(-3, '10:00', () => screenshot('mia', day(-4), 105));
  on(-3, '10:30', () => review('aj', 'mia', day(-4), 'approve'));

  // Day 3. AJ lands exactly on the limit (it counts). Dad reviews his own. Mia is over and disputes it. Leo is late.
  on(-2, '08:00', async () => {
    await screenshot('aj', day(-3), 120);
    await screenshot('ben', day(-3), 90);
    await screenshot('kaan', day(-3), 100);
    await screenshot('dad', day(-3), 100);
    await screenshot('mia', day(-3), 135);
  });
  on(-2, '09:00', async () => {
    await review('dad', 'aj', day(-3), 'approve');
    await review('dad', 'dad', day(-3), 'approve');
    for (const k of ['ben', 'kaan', 'mia'] as PersonKey[]) await review('aj', k, day(-3), 'approve');
  });
  on(-2, '10:00', async () => {
    const mine = await P('mia').getDay({ challengeId: ids.screenTime, date: day(-3) });
    await P('mia').openDispute({ recordId: mine.record!.id, reason: 'That total includes my iPad. Phone only was 1h 55m.' });
  });
  on(-2, '15:00', () => screenshot('leo', day(-3), 95, 'day', true));
  on(-2, '18:00', async () => {
    const queue = await P('aj').getReviewQueue(ids.screenTime);
    const late = queue.items.find((i) => i.kind === 'late' && i.person.userId === people.leo.id);
    if (late) await P('aj').acceptLateSubmission({ submissionId: late.submissionId, accept: true, reason: 'He was on a flight until the afternoon.' });
    await review('aj', 'leo', day(-3), 'approve');
  });

  // Day 4. Dad and Mia never submit. Leo sends the weekly view.
  on(-1, '08:00', async () => {
    await screenshot('aj', day(-2), 80);
    await screenshot('ben', day(-2), 105);
    await screenshot('kaan', day(-2), 118);
    await screenshot('leo', day(-2), 118, 'week');
  });
  on(-1, '09:00', async () => {
    await review('dad', 'aj', day(-2), 'approve');
    for (const k of ['ben', 'kaan'] as PersonKey[]) await review('aj', k, day(-2), 'approve');
  });
  on(-1, '19:00', async () => {
    // A manual correction, with a reason, shown as "Admin adjusted".
    const participant = (await P('aj').getChallenge(ids.screenTime)).allParticipants.find((p) => p.person.userId === people.dad.id);
    if (participant) {
      await P('aj').overrideDay({
        participantId: participant.id,
        date: day(-2),
        outcome: 'success',
        value: 70,
        reason: 'He showed me his phone at dinner: 1h 10m.',
        expectedRevision: 0,
      });
    }
  });
  on(-1, '21:00', () =>
    review('aj', 'leo', day(-2), 'reject', { reason: 'This is the weekly view. Send the Day view for that date.' }),
  );

  // Day 5 was yesterday. Three screenshots are waiting for review this morning; AJ, Dad and Leo have not sent theirs.
  on(0, '08:00', () => screenshot('ben', day(-1), 85));
  on(0, '08:10', () => screenshot('kaan', day(-1), 96));
  on(0, '08:20', () => screenshot('mia', day(-1), 100));

  /* ------------------------------------------------------------ Pushup Club */

  on(-4, '12:00', async () => {
    ids.pushups = await publish(
      'ben',
      draft({
        name: 'Pushup Club',
        description: 'Fifty a day. Sets count.',
        habitType: 'pushups',
        metricUnit: 'reps',
        target: 50,
        comparator: 'gte',
        requiredDays: 6,
        verification: 'self_report',
        startDate: day(-2),
        endDate: day(4),
      }),
    );
  });
  on(-3, '09:00', async () => {
    for (const k of ['aj', 'kaan', 'leo'] as PersonKey[]) await join(k, ids.pushups);
  });
  on(-2, '07:30', () => reps('aj', day(-2), 25));
  on(-2, '18:30', async () => {
    await reps('aj', day(-2), 25);
    await reps('ben', day(-2), 50);
    await reps('kaan', day(-2), 20);
    await reps('kaan', day(-2), 30);
    await reps('leo', day(-2), 30);
  });
  on(-1, '18:30', async () => {
    await reps('aj', day(-1), 20);
    await reps('aj', day(-1), 30);
    await reps('ben', day(-1), 60);
    await reps('kaan', day(-1), 50);
    await reps('leo', day(-1), 50);
  });
  // A rule change that still needs AJ's answer.
  on(-1, '20:00', async () => {
    const current = await P('ben').getChallenge(ids.pushups);
    await P('ben').proposeRuleChange({
      challengeId: ids.pushups,
      rules: { ...current.rules, target: 40 },
      reason: 'Shoulders need a break before the weekend.',
      expectedRevision: current.revision,
    });
  });
  on(-1, '21:00', async () => {
    for (const k of ['kaan', 'leo'] as PersonKey[]) {
      const seen = await P(k).getChallenge(ids.pushups);
      if (seen.proposal) await P(k).respondToRuleChange({ versionId: seen.proposal.version.id, accept: true });
    }
  });
  on(0, '07:30', () => reps('aj', day(0), 30));
  on(0, '08:00', () => reps('ben', day(0), 20));

  /* ------------------------------------------------------ The 20-minute Club */

  on(-5, '12:00', async () => {
    ids.reading = await publish(
      'mia',
      draft({
        name: 'The 20-minute Club',
        description: 'Any book, any time of day.',
        habitType: 'reading',
        metricUnit: 'minutes',
        target: 20,
        comparator: 'gte',
        requiredDays: 8,
        verification: 'self_report',
        startDate: day(-3),
        endDate: day(6),
      }),
    );
  });
  on(-4, '09:00', async () => {
    for (const k of ['aj', 'dad'] as PersonKey[]) await join(k, ids.reading);
  });
  const reading: Record<string, number[]> = { aj: [25, 20, 35], mia: [30, 45, 20], dad: [20, 10, 25] };
  [-3, -2, -1].forEach((offset, index) => {
    on(offset, '21:30', async () => {
      for (const [who, values] of Object.entries(reading)) {
        await selfReport(who as PersonKey, ids.reading, day(offset), values[index] ?? 0);
      }
    });
  });

  /* ------------------------------------------------------------ Daily Prayer */

  on(-6, '12:00', async () => {
    ids.prayer = await publish(
      'dad',
      draft({
        name: 'Daily Prayer',
        description: 'A private check-in. No details asked.',
        habitType: 'prayer',
        metricUnit: 'check-in',
        target: 1,
        comparator: 'bool',
        requiredDays: 12,
        verification: 'self_report',
        startDate: day(-4),
        endDate: day(9),
      }),
    );
  });
  on(-5, '09:00', async () => {
    for (const k of ['aj', 'kaan'] as PersonKey[]) await join(k, ids.prayer);
  });
  const prayer: Record<string, boolean[]> = { dad: [true, true, true, true], aj: [true, true, false, true], kaan: [true, true, true, true] };
  [-4, -3, -2, -1].forEach((offset, index) => {
    on(offset, '06:45', async () => {
      for (const [who, values] of Object.entries(prayer)) {
        if (values[index]) await selfReport(who as PersonKey, ids.prayer, day(offset), 1);
      }
    });
  });
  on(0, '06:30', () => selfReport('dad', ids.prayer, day(0), 1));

  /* ----------------------------------------- a scheduled challenge and a draft */

  on(-1, '12:00', async () => {
    ids.scheduled = await publish(
      'kaan',
      draft({
        name: 'Cold Shower Week',
        description: 'Thirty seconds of cold at the end. Yes or no.',
        habitType: 'custom',
        metricUnit: 'check-in',
        target: 1,
        comparator: 'bool',
        requiredDays: 5,
        verification: 'self_report',
        startDate: day(3),
        endDate: day(7),
      }),
    );
    await join('ben', ids.scheduled);
  });
  on(-1, '22:00', async () => {
    const created = await P('aj').saveDraft({
      ...draft({
        name: 'Weekend Reading Sprint',
        habitType: 'reading',
        metricUnit: 'minutes',
        target: 45,
        comparator: 'gte',
        requiredDays: 2,
        verification: 'self_report',
        startDate: day(4),
        endDate: day(5),
      }),
      draftStep: 3,
    });
    ids.draft = created.id;
  });

  /* ------------------------------------------------------------------- chat */

  on(-1, '10:24', () => P('ben').sendMessage({ circleId: ids.circle, text: 'Who is actually staying under 2 hours today?', clientId: key('msg') }));
  on(-1, '10:27', async () => {
    const message = await P('aj').sendMessage({ circleId: ids.circle, text: 'Already checked in.', clientId: key('msg') });
    await P('ben').toggleReaction({ messageId: message.id, emoji: '👏' });
    await P('mia').toggleReaction({ messageId: message.id, emoji: '👏' });
    await P('dad').toggleReaction({ messageId: message.id, emoji: '🔥' });
  });
  on(-1, '10:29', () => P('dad').sendMessage({ circleId: ids.circle, text: 'That prize is still up for grabs.', clientId: key('msg') }));

  /* -------------------------------------------------------------- run it all */

  steps.sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order);
  for (const step of steps) {
    await h.setNow(step.at);
    await step.run();
  }
  // The replay ends at nine in the morning: yesterday's proof is due by noon.
  await h.setNow(at(0, '09:00'));

  return {
    people,
    circleId: ids.circle,
    emptyCircleId: ids.empty,
    challenges: {
      screenTime: ids.screenTime,
      pushups: ids.pushups,
      reading: ids.reading,
      prayer: ids.prayer,
      scheduled: ids.scheduled,
      draft: ids.draft,
      completed: ids.completed,
    },
  };
}
