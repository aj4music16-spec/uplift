import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useToast } from '@/components/Toast';
import { toAppError } from '@/domain/errors';

import { useApp, useRepository } from './AppProvider';
import type { Repository } from './repository';

/** Query keys are scoped by the acting person so caches can never cross accounts. */
function useKey(...parts: (string | number | null | undefined)[]) {
  const { session, mode } = useApp();
  return [mode, session?.userId ?? 'anon', ...parts];
}

export function useProfile() {
  const repo = useRepository();
  const { phase } = useApp();
  return useQuery({ queryKey: useKey('profile'), queryFn: () => repo.getMyProfile(), enabled: phase === 'signed_in' });
}

export function useHome() {
  const repo = useRepository();
  return useQuery({ queryKey: useKey('home'), queryFn: () => repo.getHome() });
}

export function useHistory() {
  const repo = useRepository();
  return useQuery({ queryKey: useKey('history'), queryFn: () => repo.getHistory() });
}

export function useCircle(circleId: string | undefined) {
  const repo = useRepository();
  return useQuery({ queryKey: useKey('circle', circleId), queryFn: () => repo.getCircle(circleId!), enabled: !!circleId });
}

export function useInvites(circleId: string | undefined, enabled = true) {
  const repo = useRepository();
  return useQuery({ queryKey: useKey('invites', circleId), queryFn: () => repo.listInvites(circleId!), enabled: !!circleId && enabled });
}

export function useChallenge(challengeId: string | undefined) {
  const repo = useRepository();
  return useQuery({ queryKey: useKey('challenge', challengeId), queryFn: () => repo.getChallenge(challengeId!), enabled: !!challengeId });
}

export function useDay(challengeId: string | undefined, date: string | undefined, participantId?: string) {
  const repo = useRepository();
  return useQuery({
    queryKey: useKey('day', challengeId, date, participantId ?? 'me'),
    queryFn: () => repo.getDay({ challengeId: challengeId!, date: date!, participantId }),
    enabled: !!challengeId && !!date,
  });
}

export function useReviewQueue(challengeId: string | undefined, enabled = true) {
  const repo = useRepository();
  return useQuery({ queryKey: useKey('queue', challengeId), queryFn: () => repo.getReviewQueue(challengeId!), enabled: !!challengeId && enabled });
}

export function useEvidenceUrl(evidenceId: string | null | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: useKey('evidence', evidenceId),
    queryFn: () => repo.getEvidenceUrl(evidenceId!),
    enabled: !!evidenceId,
    // Signed URLs are short-lived: never reuse one from the cache for long.
    staleTime: 60_000,
    gcTime: 90_000,
  });
}

export function useAudit(scope: { challengeId?: string; circleId?: string }) {
  const repo = useRepository();
  return useInfiniteQuery({
    queryKey: useKey('audit', scope.challengeId ?? null, scope.circleId ?? null),
    queryFn: ({ pageParam }) => repo.listAudit({ ...scope, before: pageParam, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!scope.challengeId || !!scope.circleId,
  });
}

export function useMessages(circleId: string | undefined) {
  const repo = useRepository();
  const queryClient = useQueryClient();
  const queryKey = useKey('messages', circleId);
  // Realtime only says "something changed": the durable rows are re-read.
  useEffect(() => {
    if (!circleId) return undefined;
    return repo.subscribeToCircle(circleId, () => {
      void queryClient.invalidateQueries({ queryKey });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, repo, queryClient]);
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => repo.listMessages({ circleId: circleId!, before: pageParam, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!circleId,
  });
}

export function useNotifications() {
  const repo = useRepository();
  return useInfiniteQuery({
    queryKey: useKey('notifications'),
    queryFn: ({ pageParam }) => repo.listNotifications({ before: pageParam, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useReminders() {
  const repo = useRepository();
  return useQuery({ queryKey: useKey('reminders'), queryFn: () => repo.listReminders() });
}

export function useInvitePreview(code: string | undefined) {
  const repo = useRepository();
  return useQuery({ queryKey: useKey('invite-preview', code), queryFn: () => repo.previewInvite(code!), enabled: !!code, retry: false });
}

/**
 * A mutation with the app's standard behavior: never retried, failures shown
 * as actionable copy, and every cached view refreshed afterwards so screens
 * show canonical server data (including after a conflict, when the latest
 * version has to be loaded).
 */
export function useAction<TInput, TResult>(
  run: (repo: Repository, input: TInput) => Promise<TResult>,
  options: { onSuccess?: (result: TResult, input: TInput) => void; onError?: (error: unknown) => void; silent?: boolean } = {},
) {
  const repo = useRepository();
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: TInput) => run(repo, input),
    retry: false,
    onSuccess: (result, input) => {
      void queryClient.invalidateQueries();
      options.onSuccess?.(result, input);
    },
    onError: (error) => {
      void queryClient.invalidateQueries();
      options.onError?.(error);
      if (!options.silent && toAppError(error).code !== 'SESSION_EXPIRED') toast.error(error);
    },
  });
}

/** The repository clock, re-read on an interval so deadlines and labels stay current. */
export function useNow(intervalMs = 30_000): Date {
  const repo = useRepository();
  const [now, setNow] = useState(() => repo.now());
  useEffect(() => {
    setNow(repo.now());
    const timer = setInterval(() => setNow(repo.now()), intervalMs);
    return () => clearInterval(timer);
  }, [repo, intervalMs]);
  return now;
}
