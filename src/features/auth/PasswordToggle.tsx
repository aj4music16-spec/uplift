import { IconButton } from '@/components/Button';
import { Eye, Lock } from '@/components/icons';

/** Trailing control inside a password field that shows or hides what was typed. */
export function PasswordToggle({ visible, onToggle, testID }: { visible: boolean; onToggle: () => void; testID?: string }) {
  return (
    <IconButton
      icon={visible ? Lock : Eye}
      label={visible ? 'Hide password' : 'Show password'}
      variant="plain"
      size={40}
      onPress={onToggle}
      testID={testID}
    />
  );
}
