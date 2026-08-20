import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { config } from '../../config';
import { useSession } from '../AppProviders';
import { queryKeys } from '../query/keys';
import { RealtimeConnection, type RealtimeStatus } from './connection';

/** ws(s)://<api>/realtime, derived from the API base URL (relative in AWS, absolute locally). */
export function realtimeUrl(
  apiBaseUrl = config.apiBaseUrl,
  location: Location = window.location,
): string {
  const base = new URL(apiBaseUrl, location.href);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${base.href.replace(/\/$/, '')}/realtime`;
}

const COALESCE_MS = 150;

/**
 * Live updates for a project: realtime notifications invalidate the affected queries and
 * TanStack Query refetches them over HTTP (the source of truth). Bursts are coalesced.
 */
export function useProjectRealtime(projectId: string): RealtimeStatus {
  const queryClient = useQueryClient();
  const { token } = useSession();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const tasks = new Set<string>();
    const refresh = () => {
      pending = undefined;
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity(projectId) });
      for (const taskId of tasks) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
      }
      tasks.clear();
    };
    const schedule = () => (pending ??= setTimeout(refresh, COALESCE_MS));
    const connection = new RealtimeConnection({
      url: realtimeUrl(),
      projectId,
      getToken: () => token,
      onEvent: (event) => {
        tasks.add(event.taskId);
        schedule();
      },
      onResync: schedule,
      onStatus: setStatus,
    });
    connection.start();
    return () => {
      clearTimeout(pending);
      connection.stop();
    };
  }, [projectId, queryClient, token]);

  return status;
}
