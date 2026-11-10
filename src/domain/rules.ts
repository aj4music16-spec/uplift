import { HABITS } from './habits';
import { addDays, compareDateKeys, durationDays, isDateKey, isValidTimeZone, type DateKey } from './time';
import { LIMITS, type Comparator, type HabitType, type RuleVersionLike, type Rules, type Verification } from './types';

export interface ValidationIssue {
  field:
    | 'name'
    | 'description'
    | 'habitType'
    | 'metricUnit'
    | 'timezone'
    | 'target'
    | 'comparator'
    | 'requiredDays'
    | 'verification'
    | 'startDate'
    | 'endDate'
    | 'reason'
    | 'changes';
  message: string;
}

export interface ChallengeTerms extends Rules {
  habitType: HabitType;
  metricUnit: string;
}

/** Defaults for a brand-new challenge: seven days starting tomorrow, every day required, no reward. */
export function defaultTerms(habitType: HabitType, today: DateKey): ChallengeTerms {
  const definition = HABITS[habitType];
  const startDate = addDays(today, 1);
  return {
    habitType,
    metricUnit: definition.defaultUnit,
    target: definition.defaultTarget,
    comparator: definition.comparator,
    verification: definition.defaultVerification,
    startDate,
    endDate: addDays(startDate, 6),
    requiredDays: 7,
  };
}

/** The comparators a habit may use. Custom goals are yes/no or a numeric minimum. */
export function allowedComparators(habitType: HabitType): Comparator[] {
  if (habitType === 'custom') return ['bool', 'gte'];
  return [HABITS[habitType].comparator];
}

export function allowedVerifications(habitType: HabitType): Verification[] {
  return HABITS[habitType].evidenceMandatory ? ['evidence'] : ['self_report', 'evidence'];
}

export function validateName(name: string): ValidationIssue[] {
  const trimmed = name.trim();
  if (trimmed.length < 2) return [{ field: 'name', message: 'Give it a name with at least 2 characters.' }];
  if (trimmed.length > LIMITS.maxNameLength) {
    return [{ field: 'name', message: `Keep the name under ${LIMITS.maxNameLength} characters.` }];
  }
  return [];
}

/**
 * Validates the substantive terms of a challenge. Used before publishing and
 * (with `phase: 'change'`) for rule-change proposals. The server applies the
 * same checks in app.validate_terms.
 */
export function validateTerms(
  terms: ChallengeTerms,
  context: { today: DateKey; phase: 'publish' | 'change'; started?: boolean; currentStartDate?: DateKey },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const definition = HABITS[terms.habitType];
  if (!definition) return [{ field: 'habitType', message: 'Choose a habit.' }];

  if (!allowedComparators(terms.habitType).includes(terms.comparator)) {
    issues.push({ field: 'comparator', message: 'That goal type isn’t available for this habit.' });
  }
  if (!allowedVerifications(terms.habitType).includes(terms.verification)) {
    issues.push({
      field: 'verification',
      message: 'Screen time always needs a screenshot. It can’t be self-reported.',
    });
  }

  if (terms.comparator === 'bool') {
    if (terms.target !== 1) issues.push({ field: 'target', message: 'A yes/no goal is one check-in a day.' });
  } else {
    if (!Number.isFinite(terms.target) || terms.target <= 0) {
      issues.push({ field: 'target', message: 'Set a daily target above zero.' });
    } else if (terms.target < definition.minTarget || terms.target > definition.maxTarget) {
      issues.push({
        field: 'target',
        message: `Choose a target between ${definition.minTarget} and ${definition.maxTarget} ${terms.metricUnit}.`,
      });
    } else if (terms.habitType !== 'custom' && !Number.isInteger(terms.target)) {
      issues.push({ field: 'target', message: 'Use a whole number.' });
    }
    const unit = terms.metricUnit.trim();
    if (unit.length === 0) issues.push({ field: 'metricUnit', message: 'Name the unit, like “glasses” or “km”.' });
    else if (unit.length > LIMITS.maxUnitLength) {
      issues.push({ field: 'metricUnit', message: `Keep the unit under ${LIMITS.maxUnitLength} characters.` });
    }
  }

  if (!isDateKey(terms.startDate)) issues.push({ field: 'startDate', message: 'Choose a start date.' });
  if (!isDateKey(terms.endDate)) issues.push({ field: 'endDate', message: 'Choose an end date.' });
  if (isDateKey(terms.startDate) && isDateKey(terms.endDate)) {
    const duration = durationDays(terms.startDate, terms.endDate);
    if (duration < LIMITS.minDurationDays) {
      issues.push({ field: 'endDate', message: 'The end date can’t be before the start date.' });
    } else if (duration > LIMITS.maxDurationDays) {
      issues.push({ field: 'endDate', message: `Challenges run for up to ${LIMITS.maxDurationDays} days.` });
    }
    if (context.phase === 'publish') {
      // Starting "today" would mean the challenge already began at local
      // midnight, and nobody can join a started challenge.
      if (compareDateKeys(terms.startDate, context.today) <= 0) {
        issues.push({ field: 'startDate', message: 'Start tomorrow or later so everyone has time to join.' });
      }
    } else if (context.started) {
      if (context.currentStartDate && terms.startDate !== context.currentStartDate) {
        issues.push({ field: 'startDate', message: 'The start date can’t change once a challenge has started.' });
      }
      // New rules apply from the next challenge day, so there has to be one.
      if (compareDateKeys(terms.endDate, addDays(context.today, 1)) < 0) {
        issues.push({ field: 'endDate', message: 'The new end date must be tomorrow or later.' });
      }
    } else if (compareDateKeys(terms.startDate, context.today) <= 0) {
      issues.push({ field: 'startDate', message: 'Start tomorrow or later so everyone has time to join.' });
    }
    if (!Number.isInteger(terms.requiredDays) || terms.requiredDays < 1) {
      issues.push({ field: 'requiredDays', message: 'At least one successful day is required.' });
    } else if (duration >= 1 && terms.requiredDays > duration) {
      issues.push({ field: 'requiredDays', message: `Required days can’t be more than the ${duration} scheduled days.` });
    }
  }
  return issues;
}

export function validateTimeZone(timeZone: string): ValidationIssue[] {
  return isValidTimeZone(timeZone) ? [] : [{ field: 'timezone', message: 'Choose a valid time zone.' }];
}

export function validateReason(reason: string): ValidationIssue[] {
  const trimmed = reason.trim();
  if (trimmed.length < LIMITS.minReasonLength) return [{ field: 'reason', message: 'Add a short reason so everyone understands the change.' }];
  if (trimmed.length > LIMITS.maxReasonLength) return [{ field: 'reason', message: `Keep the reason under ${LIMITS.maxReasonLength} characters.` }];
  return [];
}

const RULE_FIELDS = ['target', 'comparator', 'requiredDays', 'verification', 'startDate', 'endDate'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

/** The fields that differ between two sets of rules, for the before/after preview. */
export function diffRules(before: Rules, after: Rules): RuleField[] {
  return RULE_FIELDS.filter((field) => before[field] !== after[field]);
}

/**
 * The rule version that governs a given challenge date: the newest version
 * that has been in force (active, or active-then-superseded) and whose
 * effective date is on or before that date. Historical days therefore keep
 * the version they ran under when later changes are accepted.
 */
export function applicableRuleVersion<T extends RuleVersionLike>(versions: readonly T[], date: DateKey): T | undefined {
  const inForce = versions
    .filter((v) => v.status === 'active' || v.status === 'superseded')
    .sort((a, b) => a.version - b.version);
  let chosen = inForce[0];
  for (const version of inForce) {
    if (compareDateKeys(version.effectiveDate, date) <= 0) chosen = version;
  }
  return chosen;
}

/**
 * When an accepted rule change takes effect: the challenge's first day if it
 * has not started, otherwise the next challenge day after acceptance.
 */
export function ruleChangeEffectiveDate(today: DateKey, startDate: DateKey): DateKey {
  const tomorrow = addDays(today, 1);
  return compareDateKeys(startDate, tomorrow) > 0 ? startDate : tomorrow;
}
