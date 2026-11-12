import type { RulesView } from '@/data/types';
import { formatDateKey, pluralize } from '@/domain/format';
import { describeGoal, verificationLabel } from '@/domain/habits';
import type { RuleField } from '@/domain/rules';
import { durationDays } from '@/domain/time';
import type { HabitType, RuleStatus } from '@/domain/types';

export const RULE_FIELD_LABEL: Record<RuleField, string> = {
  target: 'Daily goal',
  comparator: 'Goal type',
  requiredDays: 'Required days',
  verification: 'Verification',
  startDate: 'Start date',
  endDate: 'End date',
};

type RuleLike = Pick<RulesView, 'target' | 'comparator' | 'requiredDays' | 'verification' | 'startDate' | 'endDate'>;

/** A single rule field in plain words, for the before/after comparison. */
export function formatRuleField(field: RuleField, rules: RuleLike, habitType: HabitType, unit: string): string {
  switch (field) {
    case 'target':
    case 'comparator':
      return describeGoal(habitType, rules.comparator, rules.target, unit);
    case 'requiredDays':
      return `${rules.requiredDays} of ${pluralize(durationDays(rules.startDate, rules.endDate), 'day')}`;
    case 'verification':
      return verificationLabel(habitType, rules.verification);
    case 'startDate':
      return formatDateKey(rules.startDate);
    case 'endDate':
      return `${formatDateKey(rules.endDate)} (${pluralize(durationDays(rules.startDate, rules.endDate), 'day')})`;
  }
}

export const RULE_STATUS_LABEL: Record<RuleStatus, string> = {
  draft: 'Draft',
  active: 'In effect',
  superseded: 'Replaced',
  proposed: 'Proposed',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};
