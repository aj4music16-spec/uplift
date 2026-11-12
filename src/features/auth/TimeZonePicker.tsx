import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import { ChoiceRow, TextField } from '@/components/Fields';
import { Search } from '@/components/icons';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { timeZoneAbbreviation, timeZoneCity } from '@/domain/format';
import { isValidTimeZone } from '@/domain/time';
import { colors, space } from '@/theme/tokens';

import { allTimeZones, readableZone } from './timeZones';

const MAX_RESULTS = 40;

export interface TimeZonePickerProps {
  value: string;
  onSelect: (zone: string) => void;
  /** Pinned at the top, usually the device zone. */
  suggested?: string;
  testID?: string;
}

/** Searchable list of IANA time zones. Only valid zones can be chosen. */
export function TimeZonePicker({ value, onSelect, suggested, testID = 'timezone' }: TimeZonePickerProps) {
  const [query, setQuery] = useState('');
  const zones = useMemo(allTimeZones, []);
  const now = useMemo(() => new Date(), []);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '_');
    const matches = q ? zones.filter((zone) => zone.toLowerCase().includes(q) || timeZoneCity(zone).toLowerCase().includes(query.trim().toLowerCase())) : zones;
    const top = [suggested, value].filter((z, i, all): z is string => !!z && isValidTimeZone(z) && all.indexOf(z) === i && (!q || matches.includes(z)));
    return { list: [...top, ...matches.filter((zone) => !top.includes(zone))], total: matches.length };
  }, [query, zones, suggested, value]);
  const shown = results.list.slice(0, MAX_RESULTS);

  return (
    <View style={{ gap: space.md }}>
      <TextField
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="City or region, e.g. Chicago"
        autoCapitalize="none"
        returnKeyType="search"
        trailing={<Search size={18} color={colors.textSecondary} strokeWidth={2.4} />}
        testID={`${testID}-search`}
      />
      <View style={{ gap: space.sm }}>
        {shown.map((zone) => (
          <ChoiceRow
            key={zone}
            title={timeZoneCity(zone)}
            subtitle={`${readableZone(zone)} · ${timeZoneAbbreviation(now, zone)}${zone === suggested ? ' · This device' : ''}`}
            selected={zone === value}
            onPress={() => onSelect(zone)}
            testID={`${testID}-option-${zone.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`}
          />
        ))}
      </View>
      {shown.length === 0 ? (
        <Text variant="callout" color="textSecondary" align="center">
          No time zone matches “{query.trim()}”. Try a nearby large city.
        </Text>
      ) : results.list.length > shown.length ? (
        <Text variant="caption" color="textSecondary" align="center">
          Showing {shown.length} of {results.list.length}. Keep typing to narrow the list.
        </Text>
      ) : null}
    </View>
  );
}

export function TimeZoneSheet({
  visible,
  onClose,
  value,
  onSelect,
  suggested,
  subtitle,
}: {
  visible: boolean;
  onClose: () => void;
  value: string;
  onSelect: (zone: string) => void;
  suggested?: string;
  subtitle?: string;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Time zone"
      subtitle={subtitle}
      testID="timezone-sheet"
      footer={<Button label="Done" variant="ghost" size="md" onPress={onClose} />}>
      <TimeZonePicker
        value={value}
        suggested={suggested}
        onSelect={(zone) => {
          onSelect(zone);
          onClose();
        }}
      />
    </Sheet>
  );
}
