import { StatusBadge } from '@/components/Badges';
import { Crown, Shield } from '@/components/icons';
import type { CircleRole } from '@/domain/types';

export const ROLE_LABEL: Record<CircleRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export function RoleBadge({ role }: { role: CircleRole }) {
  if (role === 'owner') return <StatusBadge label="Owner" tone="ink" icon={Crown} />;
  if (role === 'admin') return <StatusBadge label="Admin" tone="info" icon={Shield} />;
  return <StatusBadge label="Member" tone="neutral" />;
}

export function canManageCircle(role: CircleRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}
