import type { ReactNode } from 'react';

import { Banner } from '@/components/Badges';
import { CircleAlert } from '@/components/icons';
import { describeError } from '@/domain/errors';

/** Inline, actionable copy for a failed auth request. */
export function ErrorBanner({ error, action }: { error: unknown; action?: ReactNode }) {
  if (!error) return null;
  const copy = describeError(error);
  return <Banner tone="danger" icon={CircleAlert} title={copy.title} message={copy.message} action={action} />;
}
