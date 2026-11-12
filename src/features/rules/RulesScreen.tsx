import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { StatusBadge, type BadgeTone } from '@/components/Badges';
import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { ChoiceRow, Stepper, TextField } from '@/components/Fields';
import { ArrowRight, Check, CircleHelp, Clock, Lock, X } from '@/components/icons';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { ConfirmationSheet, Sheet } from '@/components/Sheet';
import { QueryBoundary, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useToast } from '@/components/Toast';
import { useAction, useChallenge, useNow } from '@/data/hooks';
import type { ChallengeDetail, RuleChangeInput, RulesView } from '@/data/types';
import { formatDateKey, formatDateRange, formatTime, pluralize, timeZoneAbbreviation, timeZoneCity } from '@/domain/format';
import { describeGoal, formatMinutes, formatNumber, HABITS, verificationLabel } from '@/domain/habits';
import { allowedVerifications, diffRules, validateReason, validateTerms, type RuleField } from '@/domain/rules';
import { addDays, dayWindow, diffDays, durationDays, todayKey } from '@/domain/time';
import { LIMITS, type RuleStatus } from '@/domain/types';
import { colors, space } from '@/theme/tokens';

import { formatRuleField, RULE_FIELD_LABEL, RULE_STATUS_LABEL } from './ruleText';

const STATUS_TONE: Record<RuleStatus, BadgeTone> = {
  draft: 'neutral',
  active: 'positive',
  superseded: 'neutral',
  proposed: 'warning',
  declined: 'neutral',
  withdrawn: 'neutral',
};

/** The complete rules of a challenge, their version history, and rule-change proposals. */
export function RulesScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const query = useChallenge(challengeId);
  return (
    <QueryBoundary
      query={query}
      loading={
        <Screen header={<NavHeader title="Rules" />}>
          <LoadingState variant="detail" />
        </Screen>
      }>
      {(challenge) => <RulesContent challenge={challenge} />}
    </QueryBoundary>
  );
}

/** Visible fields only: the goal type never changes, so target and comparator read as one line. */
function changedFields(before: RulesView, after: RulesView): RuleField[] {
  const fields = diffRules(before, after);
  return fields.includes('target') && fields.includes('comparator') ? fields.filter((f) => f !== 'comparator') : fields;
}

function RulesContent({ challenge }: { challenge: ChallengeDetail }) {
  const toast = useToast();
  const now = useNow();
  const { rules, proposal, viewer } = challenge;
  const [proposing, setProposing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const respond = useAction((repo, accept: boolean) => repo.respondToRuleChange({ versionId: proposal!.version.id, accept }), {
    onSuccess: (_result, accept) => {
      setDeclining(false);
      toast.success(accept ? 'You accepted the new rules' : 'You declined the change', accept ? undefined : 'The original rules stay.');
    },
  });
  const withdraw = useAction((repo, versionId: string) => repo.withdrawRuleChange(versionId), {
    onSuccess: () => {
      setWithdrawing(false);
      toast.success('Proposal withdrawn', 'The current rules stay as they are.');
    },
  });

  const unit = challenge.metricUnit;
  const habitType = challenge.habitType;
  const days = durationDays(rules.startDate, rules.endDate);
  const deadlineExample = dayWindow(rules.startDate, challenge.timezone).deadlineAt;
  const editable = challenge.status === 'scheduled' || challenge.status === 'active';
  const canPropose = viewer.isAdmin && editable && !proposal;
  const myPending = !!proposal && proposal.myDecision === 'pending' && !!viewer.participantId && !viewer.removed;

  const versions = [...challenge.ruleVersions].sort((a, b) => b.version - a.version);

  const footer = myPending ? (
    <>
      <Button label="Accept new rules" icon={Check} loading={respond.isPending && respond.variables === true} onPress={() => respond.mutate(true)} testID="rules-accept" />
      <Button label="Decline" variant="secondary" size="md" onPress={() => setDeclining(true)} testID="rules-decline" />
    </>
  ) : canPropose ? (
    <Button label="Propose a change" onPress={() => setProposing(true)} testID="rules-propose" />
  ) : undefined;

  return (
    <Screen header={<NavHeader title="Rules" />} footer={footer} testID="rules-screen">
      <TitleBlock title="Rules" subtitle={challenge.name} />

      {proposal ? (
        <Card testID="rules-proposal">
          <View style={{ gap: space.xs }}>
            <StatusBadge label="Rule change proposed" tone="warning" icon={Clock} />
            <Text variant="headline">
              {proposal.proposedBy.deleted ? 'A former member' : proposal.proposedBy.displayName} wants to change the rules
            </Text>
            <Text variant="callout" color="textSecondary">
              Reason: {proposal.reason}
            </Text>
          </View>
          <View style={{ gap: space.md }}>
            {changedFields(rules, proposal.version).map((field) => (
              <View key={field} style={{ gap: 4 }}>
                <Text variant="captionStrong" color="textSecondary">
                  {RULE_FIELD_LABEL[field]}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                  <Text variant="callout" color="textSecondary" style={{ textDecorationLine: 'line-through' }}>
                    {formatRuleField(field, rules, habitType, unit)}
                  </Text>
                  <ArrowRight size={15} color={colors.textSecondary} strokeWidth={2.4} />
                  <Text variant="calloutStrong">{formatRuleField(field, proposal.version, habitType, unit)}</Text>
                </View>
              </View>
            ))}
          </View>
          <Banner
            message={`Everyone playing has to accept. If anyone declines, the original rules stay. Accepted rules apply from the next challenge day; days before that keep the rules they ran under.`}
          />
          <Divider />
          <View style={{ gap: space.sm }}>
            <Text variant="calloutStrong">Responses</Text>
            {proposal.responses.map((response) => (
              <View key={response.participantId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 }}>
                <Avatar avatar={response.person.avatar} ghost={response.person.deleted} size={32} name="" />
                <Text variant="body" style={{ flex: 1 }}>
                  {response.person.deleted ? 'Deleted member' : response.person.displayName}
                  {response.participantId === viewer.participantId ? ' (you)' : ''}
                </Text>
                <StatusBadge
                  label={response.decision === 'accepted' ? 'Accepted' : response.decision === 'declined' ? 'Declined' : 'Waiting'}
                  tone={response.decision === 'accepted' ? 'positive' : response.decision === 'declined' ? 'danger' : 'neutral'}
                  icon={response.decision === 'accepted' ? Check : response.decision === 'declined' ? X : Clock}
                />
              </View>
            ))}
          </View>
          {viewer.isAdmin ? (
            <Button label="Withdraw proposal" variant="danger" size="md" onPress={() => setWithdrawing(true)} testID="rules-withdraw" />
          ) : null}
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <SectionHeading title="Current rules" />
        <Card>
          <RuleLine label="Daily goal" value={describeGoal(habitType, rules.comparator, rules.target, unit)} />
          <RuleLine label="Dates" value={`${formatDateRange(rules.startDate, rules.endDate)} · ${pluralize(days, 'day')}`} />
          <RuleLine label="Required days" value={`${rules.requiredDays} successful ${rules.requiredDays === 1 ? 'day' : 'days'} out of ${days} to finish`} />
          <RuleLine label="Verification" value={verificationLabel(habitType, rules.verification)} />
          <RuleLine
            label="Time zone"
            value={`${timeZoneCity(challenge.timezone)} (${timeZoneAbbreviation(now, challenge.timezone)}). Every day runs midnight to midnight here. It can’t change after publishing.`}
            locked
          />
          <RuleLine
            label="Deadline"
            value={`Each day’s check-in is due by ${formatTime(deadlineExample, challenge.timezone)} the next day. ${
              HABITS[habitType].requiresFinishedDay ? 'Proof can only be sent once the day is over.' : ''
            }`.trim()}
          />
          {habitType === 'screen_time' ? (
            <RuleLine
              label="Device"
              value="Total screen time on one primary phone, from the system’s day view showing the date and total. Weekly averages and totals across devices don’t count."
            />
          ) : null}
          {HABITS[habitType].privateDetail ? <RuleLine label="Privacy" value="Check-ins are private yes/no answers. The group only sees that the daily goal was completed." /> : null}
        </Card>
        <Text variant="caption" color="textSecondary">
          The habit and time zone can’t change after publishing. Admins edit the name and description in the admin console; those edits apply right away.
        </Text>
      </View>

      {!myPending && !canPropose ? (
        <Banner
          icon={CircleHelp}
          message={
            !editable
              ? 'Rules can only change while a challenge is scheduled or running.'
              : proposal
                ? proposal.myDecision === 'accepted'
                  ? 'You accepted this change. It applies once everyone has accepted.'
                  : proposal.myDecision === 'declined'
                    ? 'You declined this change, so the original rules stay.'
                    : 'Players respond to the proposal. Only challenge admins can withdraw it.'
                : 'Only challenge admins can propose rule changes. Everyone playing must accept before they apply.'
          }
        />
      ) : null}

      <View style={{ gap: space.md }}>
        <SectionHeading title="Version history" />
        <Text variant="callout" color="textSecondary">
          Each day is scored with the version in effect on that date. Accepted changes never rewrite earlier days.
        </Text>
        {versions.map((version) => (
          <Card key={version.id} padding={space.lg}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <Text variant="subhead" style={{ flex: 1 }}>
                Version {version.version}
              </Text>
              <StatusBadge label={RULE_STATUS_LABEL[version.status]} tone={STATUS_TONE[version.status]} />
            </View>
            <Text variant="callout" color="textSecondary">
              {describeGoal(habitType, version.comparator, version.target, unit)} · {version.requiredDays} of {durationDays(version.startDate, version.endDate)} days ·{' '}
              {formatDateRange(version.startDate, version.endDate)} · {verificationLabel(habitType, version.verification)}
            </Text>
            <Text variant="caption" color="textSecondary">
              {version.status === 'active' || version.status === 'superseded'
                ? `Applies from ${formatDateKey(version.effectiveDate)}`
                : version.status === 'proposed'
                  ? `Would apply from ${formatDateKey(version.effectiveDate)} if everyone accepts`
                  : 'Never took effect'}
            </Text>
          </Card>
        ))}
      </View>

      {proposing ? <ProposeSheet challenge={challenge} onClose={() => setProposing(false)} /> : null}

      <ConfirmationSheet
        visible={declining}
        onClose={() => setDeclining(false)}
        title="Decline the new rules?"
        message="If you decline, the change doesn’t happen and the original rules stay for everyone."
        confirmLabel="Decline change"
        confirmVariant="danger"
        loading={respond.isPending}
        onConfirm={() => respond.mutate(false)}
        testID="rules-decline-sheet"
      />
      <ConfirmationSheet
        visible={withdrawing}
        onClose={() => setWithdrawing(false)}
        title="Withdraw this proposal?"
        message="The current rules stay. You can propose a different change afterwards."
        confirmLabel="Withdraw proposal"
        confirmVariant="danger"
        loading={withdraw.isPending}
        onConfirm={() => proposal && withdraw.mutate(proposal.version.id)}
        testID="rules-withdraw-sheet"
      />
    </Screen>
  );
}

function RuleLine({ label, value, locked = false }: { label: string; value: string; locked?: boolean }) {
  return (
    <View style={{ gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text variant="captionStrong" color="textSecondary">
          {label}
        </Text>
        {locked ? <Lock size={12} color={colors.textSecondary} strokeWidth={2.4} /> : null}
      </View>
      <Text variant="body">{value}</Text>
    </View>
  );
}

function ProposeSheet({ challenge, onClose }: { challenge: ChallengeDetail; onClose: () => void }) {
  const toast = useToast();
  const now = useNow();
  const { rules } = challenge;
  const definition = HABITS[challenge.habitType];
  const today = todayKey(now, challenge.timezone);
  const started = challenge.status === 'active';

  const [target, setTarget] = useState(rules.target);
  const [length, setLength] = useState(durationDays(rules.startDate, rules.endDate));
  const [requiredDays, setRequiredDays] = useState(rules.requiredDays);
  const [verification, setVerification] = useState(rules.verification);
  const [reason, setReason] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const minLength = Math.min(LIMITS.maxDurationDays, Math.max(1, started ? diffDays(rules.startDate, addDays(today, 1)) + 1 : 1));
  const next: RuleChangeInput = {
    target,
    comparator: rules.comparator,
    requiredDays,
    verification,
    startDate: rules.startDate,
    endDate: addDays(rules.startDate, length - 1),
  };
  const preview: RulesView = { ...rules, ...next };
  const changes = changedFields(rules, preview);
  const issues = [
    ...validateTerms({ ...next, habitType: challenge.habitType, metricUnit: challenge.metricUnit }, { phase: 'change', started, currentStartDate: rules.startDate, today }),
    ...validateReason(reason),
  ];
  const termIssues = issues.filter((i) => i.field !== 'reason');
  const reasonIssue = issues.find((i) => i.field === 'reason');

  const propose = useAction(
    (repo, input: { rules: RuleChangeInput; reason: string }) =>
      repo.proposeRuleChange({ challengeId: challenge.id, rules: input.rules, reason: input.reason, expectedRevision: challenge.revision }),
    {
      onSuccess: () => {
        toast.success('Proposal sent', 'Everyone playing is asked to accept it.');
        onClose();
      },
    },
  );

  const formatTarget = (value: number) => (challenge.metricUnit === 'minutes' ? formatMinutes(value) : `${formatNumber(value)} ${challenge.metricUnit}`);
  const verifications = allowedVerifications(challenge.habitType);

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Propose a change"
      subtitle="Everyone playing must accept. If anyone declines, the original rules stay. Accepted rules apply from the next challenge day."
      testID="rules-propose-sheet"
      footer={
        <>
          <Button
            label="Send proposal"
            loading={propose.isPending}
            disabled={changes.length === 0}
            disabledReason="Change at least one rule first"
            onPress={() => {
              setShowErrors(true);
              if (issues.length === 0) propose.mutate({ rules: next, reason: reason.trim() });
            }}
            testID="rules-propose-submit"
          />
          <Button label="Not now" variant="ghost" size="md" onPress={onClose} />
        </>
      }>
      {rules.comparator !== 'bool' ? (
        <Stepper
          label={rules.comparator === 'lte' ? 'Daily maximum' : 'Daily target'}
          value={target}
          onChange={setTarget}
          min={definition.minTarget}
          max={definition.maxTarget}
          step={definition.targetStep}
          format={formatTarget}
          testID="rules-target"
        />
      ) : null}
      <Stepper
        label="Length"
        value={length}
        onChange={(value) => {
          setLength(value);
          if (requiredDays > value) setRequiredDays(value);
        }}
        min={minLength}
        max={LIMITS.maxDurationDays}
        format={(value) => `${pluralize(value, 'day')}`}
        helper={`Ends ${formatDateKey(addDays(rules.startDate, length - 1))}.${started ? ' The start date can’t move once the challenge has started.' : ''}`}
        testID="rules-length"
      />
      <Stepper
        label="Required successful days"
        value={requiredDays}
        onChange={setRequiredDays}
        min={1}
        max={Math.max(1, length)}
        format={(value) => `${value} of ${length}`}
        testID="rules-required-days"
      />
      <View style={{ gap: space.sm }}>
        <Text variant="calloutStrong">Verification</Text>
        {(['evidence', 'self_report'] as const).map((option) => (
          <ChoiceRow
            key={option}
            title={verificationLabel(challenge.habitType, option)}
            selected={verification === option}
            onPress={() => setVerification(option)}
            disabled={!verifications.includes(option)}
            disabledNote="Screen time always needs a screenshot. It can’t be self-reported."
            testID={`rules-verification-${option}`}
          />
        ))}
      </View>
      <TextField
        label="Reason"
        value={reason}
        onChangeText={setReason}
        placeholder="Why should the rules change?"
        multiline
        maxLength={LIMITS.maxReasonLength}
        helper="Required. Everyone playing sees it."
        error={showErrors && reasonIssue ? reasonIssue.message : undefined}
        testID="rules-reason"
      />
      <Card padding={space.lg}>
        <Text variant="calloutStrong">Before → after</Text>
        {changes.length === 0 ? (
          <Text variant="callout" color="textSecondary">
            Nothing has changed yet.
          </Text>
        ) : (
          changes.map((field) => (
            <View key={field} style={{ gap: 2 }}>
              <Text variant="captionStrong" color="textSecondary">
                {RULE_FIELD_LABEL[field]}
              </Text>
              <Text variant="callout">
                {formatRuleField(field, rules, challenge.habitType, challenge.metricUnit)} → {formatRuleField(field, preview, challenge.habitType, challenge.metricUnit)}
              </Text>
            </View>
          ))
        )}
      </Card>
      {termIssues.map((issue) => (
        <Banner key={`${issue.field}-${issue.message}`} tone="danger" message={issue.message} />
      ))}
    </Sheet>
  );
}
