import type { ChallengeCard } from '@/data/types';
import { formatDateTime, possessiveDay } from '@/domain/format';
import { HABITS, formatMinutes, formatNumber } from '@/domain/habits';
import { compareDateKeys, dateKeyAt, dayWindow } from '@/domain/time';
import type { ChallengeStatus, HabitType } from '@/domain/types';

/**
 * Home's "Today" list: the viewer's unfinished work across challenges, in
 * priority order. Pure — everything comes from server-derived card fields and
 * the repository clock, so it can be unit tested and reused on any screen.
 */

export type HomeActionKind = 'resubmit' | 'due' | 'review' | 'dispute' | 'proposal' | 'log_today' | 'join' | 'finalize' | 'draft';

export interface HomeAction {
  key: string;
  kind: HomeActionKind;
  challengeId: string;
  title: string;
  subtitle: string;
  href: string;
  /** A deadline is involved (resubmission or an overdue day still open for proof). */
  urgent: boolean;
}

const PRIORITY: Record<HomeActionKind, number> = {
  resubmit: 0,
  due: 1,
  review: 2,
  dispute: 2,
  proposal: 3,
  log_today: 4,
  join: 5,
  finalize: 6,
  draft: 7,
};

/** Challenge states in which the viewer can still submit for past or current days. */
const SUBMITTING: readonly ChallengeStatus[] = ['active', 'review'];

/** Noun used in "Log yesterday’s …". */
const HABIT_NOUN: Record<HabitType, string> = {
  screen_time: 'screen time',
  reading: 'reading',
  prayer: 'prayer',
  pushups: 'pushups',
  custom: 'check-in',
};

function pluralCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function checkinHref(card: ChallengeCard, date: string): string {
  return `/challenge/${card.id}/checkin?date=${date}`;
}

export function deriveActions(cards: readonly ChallengeCard[], now: Date): HomeAction[] {
  const out: { action: HomeAction; sortAt: number; order: number }[] = [];
  let order = 0;
  const push = (action: HomeAction, sortAt = 0) => {
    out.push({ action, sortAt, order: order++ });
  };

  for (const card of cards) {
    const today = dateKeyAt(now, card.timezone);
    const definition = HABITS[card.habitType];
    const participating = !!card.viewer.participantId && !card.viewer.removed;

    if (participating && SUBMITTING.includes(card.status)) {
      for (const day of card.myDays) {
        const window = dayWindow(day.date, card.timezone);
        const dayLabel = possessiveDay(day.date, today);
        if (day.status === 'rejected') {
          push(
            {
              key: `resubmit:${card.id}:${day.date}`,
              kind: 'resubmit',
              challengeId: card.id,
              title: card.habitType === 'screen_time' ? `Resubmit ${dayLabel} screenshot` : `Resubmit ${dayLabel} proof`,
              subtitle: `${card.name} · The admin asked for new proof`,
              href: checkinHref(card, day.date),
              urgent: true,
            },
            window.deadlineAt.getTime(),
          );
        } else if (day.status === 'due') {
          // Proof for a day can only be sent once that day is over, and only until its deadline.
          if (now.getTime() < window.endsAt.getTime() || now.getTime() >= window.deadlineAt.getTime()) continue;
          push(
            {
              key: `due:${card.id}:${day.date}`,
              kind: 'due',
              challengeId: card.id,
              title: card.habitType === 'screen_time' ? `Submit ${dayLabel} screenshot` : `Log ${dayLabel} ${HABIT_NOUN[card.habitType]}`,
              subtitle: `${card.name} · Due ${formatDateTime(window.deadlineAt, card.timezone)}`,
              href: checkinHref(card, day.date),
              urgent: true,
            },
            window.deadlineAt.getTime(),
          );
        } else if (
          day.status === 'open' &&
          day.date === today &&
          card.status === 'active' &&
          !definition.requiresFinishedDay &&
          !definition.evidenceMandatory
        ) {
          let title = 'Check in for today';
          let detail = 'Open until midnight';
          if (card.habitType === 'reading') title = 'Log today’s reading';
          if (card.habitType === 'pushups') {
            title = 'Log reps';
            if (day.value !== null && day.value !== undefined) {
              detail = `${formatNumber(day.value)} / ${formatNumber(card.rules.target)} today`;
            }
          } else if (card.habitType === 'reading' && day.value !== null && day.value !== undefined && card.metricUnit === 'minutes') {
            detail = `${formatMinutes(day.value)} of ${formatMinutes(card.rules.target)} so far`;
          }
          push({
            key: `today:${card.id}:${day.date}`,
            kind: 'log_today',
            challengeId: card.id,
            title,
            subtitle: `${card.name} · ${detail}`,
            href: checkinHref(card, day.date),
            urgent: false,
          });
        }
      }
    }

    if (card.viewer.isAdmin && card.pendingReviewCount > 0) {
      push({
        key: `review:${card.id}`,
        kind: 'review',
        challengeId: card.id,
        title: `Review ${pluralCount(card.pendingReviewCount, 'submission', 'submissions')}`,
        subtitle: `${card.name} · Pending proof doesn’t count until you decide`,
        href: `/challenge/${card.id}/review`,
        urgent: false,
      });
    }
    if (card.viewer.isAdmin && card.openDisputeCount > 0) {
      push({
        key: `dispute:${card.id}`,
        kind: 'dispute',
        challengeId: card.id,
        title: card.openDisputeCount === 1 ? 'Resolve a dispute' : `Resolve ${card.openDisputeCount} disputes`,
        subtitle: `${card.name} · A player asked you to look again`,
        href: `/challenge/${card.id}/review`,
        urgent: false,
      });
    }
    if (card.proposalAwaitingMe) {
      push({
        key: `proposal:${card.id}`,
        kind: 'proposal',
        challengeId: card.id,
        title: 'Respond to a rule change',
        subtitle: `${card.name} · Nothing changes until you answer`,
        href: `/challenge/${card.id}/rules`,
        urgent: false,
      });
    }
    if (card.status === 'scheduled' && !card.viewer.participantId && !card.viewer.removed) {
      push({
        key: `join:${card.id}`,
        kind: 'join',
        challengeId: card.id,
        title: 'Review the rules and join',
        subtitle: `${card.name} · Starts ${compareDateKeys(card.startDate, today) > 0 ? possessiveDay(card.startDate, today).replace(/’s$/, '') : 'soon'}`,
        href: `/challenge/${card.id}`,
        urgent: false,
      });
    }
    if (card.readyToFinalize && card.viewer.isAdmin) {
      push({
        key: `finalize:${card.id}`,
        kind: 'finalize',
        challengeId: card.id,
        title: 'Finalize results',
        subtitle: `${card.name} · Every review is done`,
        href: `/challenge/${card.id}/results`,
        urgent: false,
      });
    }
    if (card.status === 'draft') {
      push({
        key: `draft:${card.id}`,
        kind: 'draft',
        challengeId: card.id,
        title: 'Finish your draft',
        subtitle: `${card.name} · Step ${Math.min(5, Math.max(1, card.draftStep))} of 5`,
        href: `/challenge/new?draftId=${card.id}`,
        urgent: false,
      });
    }
  }

  return out
    .sort((a, b) => PRIORITY[a.action.kind] - PRIORITY[b.action.kind] || a.sortAt - b.sortAt || a.order - b.order)
    .map((entry) => entry.action);
}

export interface ChallengeGroups {
  live: ChallengeCard[];
  scheduled: ChallengeCard[];
  drafts: ChallengeCard[];
  finished: ChallengeCard[];
}

/** Active and in-review first, then starting soon, drafts and recently finished (newest first). */
export function groupChallenges(cards: readonly ChallengeCard[]): ChallengeGroups {
  const byEnd = (a: ChallengeCard, b: ChallengeCard) => compareDateKeys(a.endDate, b.endDate);
  const byStart = (a: ChallengeCard, b: ChallengeCard) => compareDateKeys(a.startDate, b.startDate);
  return {
    live: cards.filter((c) => c.status === 'active' || c.status === 'review').sort((a, b) => (a.status === b.status ? byEnd(a, b) : a.status === 'active' ? -1 : 1)),
    scheduled: cards.filter((c) => c.status === 'scheduled').sort(byStart),
    drafts: cards.filter((c) => c.status === 'draft').sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    finished: cards.filter((c) => c.status === 'completed' || c.status === 'canceled').sort((a, b) => byEnd(b, a)),
  };
}
