import { useApp } from '@/data/AppProvider';

/**
 * Where to go once a session exists: a waiting invitation first, otherwise
 * home (which sends people without a finished profile to profile setup).
 */
export function useAfterSignInHref(): string {
  const { pendingInvite } = useApp();
  return pendingInvite ? `/invite/${pendingInvite}` : '/';
}
