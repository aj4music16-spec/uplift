import { View } from 'react-native';

import { Banner } from '@/components/Badges';
import { Card } from '@/components/Card';
import { CircleX, Eye, FileText, History, ImageOff, Lock, Shield, Trash2, type LucideIcon } from '@/components/icons';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { Text } from '@/components/Text';
import { LIMITS } from '@/domain/types';
import { colors, space } from '@/theme/tokens';

function Point({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }} accessible accessibilityLabel={`${title}. ${text}`}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={17} color={colors.ink} strokeWidth={2.3} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="callout" color="textSecondary">
          {text}
        </Text>
      </View>
    </View>
  );
}

/** Plain-language privacy summary, built from the product rules. */
export function PrivacyScreen() {
  return (
    <Screen header={<NavHeader title="Privacy" />} testID="privacy-screen">
      <TitleBlock title="Privacy" subtitle="What others can see, what Uplift keeps, and for how long." />

      <View style={{ gap: space.md }}>
        <SectionHeading title="Who sees what" />
        <Card>
          <Point
            icon={Lock}
            title="Your proof is private"
            text="Screenshots and photos are seen only by you and the admins assigned to that challenge. They’re stored privately, opened through links that expire within minutes, and never posted to chat."
          />
          <Point
            icon={Eye}
            title="The group sees outcomes"
            text="Other players see whether a day counted, your successful days and your rank — not your screenshots and not the amounts you entered."
          />
          <Point icon={CircleX} title="Rejections stay between you and the admins" text="If proof isn’t accepted, the reason goes only to you. Other players don’t see that it was rejected." />
          <Point icon={Shield} title="Prayer stays private" text="Prayer check-ins are a simple yes. The group only sees that the daily goal was completed — nothing else is asked or shared." />
          <Point icon={History} title="Admin access is recorded" text="When an admin reviews or corrects your day, it’s recorded in that day’s history, which you can see." />
        </Card>
      </View>

      <View style={{ gap: space.md }}>
        <SectionHeading title="What’s kept" />
        <Card>
          <Point
            icon={FileText}
            title="Scores and change history"
            text="Results and the history of every review and correction are kept so the record stays fair. Corrections are added, never silently rewritten."
          />
          <Point
            icon={Trash2}
            title="Proof files are deleted"
            text={`The proposed beta policy deletes proof files ${LIMITS.evidenceRetentionDays} days after a challenge ends, later if a dispute is still open.`}
          />
          <Point icon={ImageOff} title="Location removed" text="Location and other photo metadata are stripped from images before they’re uploaded, where the device allows it." />
        </Card>
        <Banner
          message="Automatic deletion is a job the operator of this Uplift server has to configure. In a test build it may not be running yet, so don’t rely on it for sensitive images."
        />
      </View>

      <View style={{ gap: space.md }}>
        <SectionHeading title="What we don’t do" />
        <Card>
          <Point icon={Shield} title="No ads, no selling data" text="Uplift shows no ads and doesn’t sell or share your data with advertisers." />
          <Point icon={Trash2} title="You can delete your account" text="Your proof files are removed and your name is replaced by “Deleted member” in shared history. Find it under Account." />
        </Card>
      </View>
    </Screen>
  );
}
