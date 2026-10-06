import { QueryClient } from '@tanstack/react-query';

/**
 * Pages show a retry button when a request fails, so queries never retry or refetch on
 * their own: every request a customer sees is one they asked for.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Thrown by a query function whose session changed while it ran, including a token another
 * tab wrote before this one re-rendered. Pages treat it as still loading: the response
 * belongs to nobody on screen, so it is neither shown nor reported.
 */
export class StaleSessionError extends Error {
  constructor() {
    super('Session changed while the request was in flight');
    this.name = 'StaleSessionError';
  }
}
