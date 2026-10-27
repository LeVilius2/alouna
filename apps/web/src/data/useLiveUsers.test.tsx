import { act, renderHook } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { DataContext } from './context';
import { freshPosition, makeLivePosition } from './livePosition';
import * as realtime from './realtime';
import { useLiveUsers } from './useLiveUsers';

it('uses the packet receipt clock immediately and hides a position when it expires', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const userId = '00000000-0000-0000-0000-000000000001',
    sessionId = '10000000-0000-0000-0000-000000000001';
  let callbacks!: realtime.LiveCallbacks;
  vi.spyOn(realtime, 'createLiveTransport').mockReturnValue({
    members: async () => [{ id: userId, display_name: 'Walker' }],
    open: (_id, cb) => {
      callbacks = cb;
      return { send: async () => true, track: async () => true, close: async () => {} };
    },
  });
  const view = renderHook(() => useLiveUsers(userId, true), {
    wrapper: ({ children }) => (
      <DataContext.Provider
        value={{
          client: {} as SupabaseClient,
          configured: true,
          store: null,
          offline: false,
          signOut: async () => {},
        }}
      >
        {children}
      </DataContext.Provider>
    ),
  });
  try {
    await act(async () => {});
    await act(async () => {
      // A packet arrives between the one-second display ticks.
      vi.setSystemTime(10100);
      callbacks.presence([sessionId]);
      callbacks.position(
        makeLivePosition(
          {
            fix: { position: [25, 55], accuracyM: 2, timestamp: 10100, speedMps: 1 },
            heading: null,
            headingTimestamp: null,
            destinationId: null,
            progress: null,
            remainingM: null,
            route: null,
            battery: null,
            source: 'simulator',
            status: 'guiding',
          },
          userId,
          sessionId,
          1,
          10100,
        ),
      );
    });
    expect(freshPosition(view.result.current.users[0]!, view.result.current.now)).toEqual([25, 55]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(freshPosition(view.result.current.users[0]!, view.result.current.now)).toBeNull();
  } finally {
    view.unmount();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
