import {
  BackendError,
  emptyData,
  type DataBackend,
  type DataError,
  type DataStorage,
  type LocalData,
  type Mutation,
} from './types';

const classify = (error: unknown): Exclude<DataError, null> =>
  error instanceof BackendError ? error.code : 'offline';

/** Published routing data and pending edits are deliberately separate. */
export class FeatureStore {
  private current = emptyData();
  private listeners = new Set<() => void>();
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    readonly userId: string,
    private storage: DataStorage,
    private backend: DataBackend,
  ) {}
  getSnapshot = (): LocalData => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(data: LocalData): void {
    this.current = data;
    for (const listener of this.listeners) listener();
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation, operation);
    this.pending = next.catch(() => {});
    return next;
  }
  private async save(change: (data: LocalData) => LocalData): Promise<void> {
    try {
      this.publish(await this.storage.update(change));
    } catch (error) {
      if (error instanceof BackendError && error.code === 'denied') throw error;
      this.publish({ ...this.current, snapshot: null, error: 'invalid-data' });
      throw new BackendError('invalid-data');
    }
  }
  async open(): Promise<void> {
    this.publish(await this.storage.read());
  }

  enqueue(input: Omit<Mutation, 'operationId' | 'status'>): Promise<string> {
    return this.serialize(async () => {
      const operationId = crypto.randomUUID();
      await this.save((data) => {
        if (!data.profile?.active) throw new BackendError('denied');
        if (input.kind === 'save-rule' && data.profile.role !== 'admin')
          throw new BackendError('denied');
        const earlier = data.queue.filter(
          (m) =>
            m.entityId === input.entityId &&
            (m.kind === 'save-rule') === (input.kind === 'save-rule'),
        );
        const expectedRevision = earlier.length
          ? Math.max(...earlier.map((m) => m.expectedRevision)) + 1
          : input.expectedRevision;
        return {
          ...data,
          queue: [
            ...data.queue,
            { ...structuredClone(input), expectedRevision, operationId, status: 'pending' },
          ],
        };
      });
      return operationId;
    });
  }

  /** Never auto-rebase a conflict: the user must review/discard their pending edits. */
  discardEntity(entityId: string): Promise<void> {
    return this.serialize(() =>
      this.save((data) => ({
        ...data,
        queue: data.queue.filter((m) => m.entityId !== entityId),
        error: null,
      })),
    );
  }

  /** Replace the pending queue (used by editor undo/redo for mutations that have not synced yet). */
  replaceQueue(queue: readonly Mutation[]): Promise<void> {
    return this.serialize(() =>
      this.save((data) => {
        if (!data.profile?.active) throw new BackendError('denied');
        const problem = queue.find((m) => m.status !== 'pending');
        return {
          ...data,
          queue: structuredClone([...queue]),
          error: problem && problem.status !== 'pending' ? problem.status : null,
        };
      }),
    );
  }

  sync(): Promise<void> {
    return this.serialize(async () => {
      // Recheck membership before replaying persisted work, including after suspension.
      try {
        const loaded = await this.backend.load(this.userId);
        await this.save((data) => ({ ...data, ...loaded, error: null }));
      } catch (error) {
        await this.fail(classify(error));
        return;
      }
      const blocked = new Set<string>();
      for (const mutation of (await this.storage.read()).queue) {
        const identity = `${mutation.kind === 'save-rule' ? 'rule' : 'feature'}:${mutation.entityId}`;
        if (mutation.status !== 'pending' || blocked.has(identity)) {
          blocked.add(identity);
          continue;
        }
        try {
          await this.backend.mutate(this.userId, mutation);
          // A lost response keeps exactly this operation ID for safe idempotent replay.
          await this.save((data) => ({
            ...data,
            queue: data.queue.filter((m) => m.operationId !== mutation.operationId),
          }));
        } catch (error) {
          const code = classify(error);
          if (code === 'offline') {
            await this.fail(code);
            return;
          }
          blocked.add(identity);
          await this.save((data) => ({
            ...data,
            error: code,
            queue: data.queue.map((m) =>
              m.operationId === mutation.operationId ? { ...m, status: code } : m,
            ),
          }));
          if (code === 'denied') {
            await this.fail(code);
            return;
          }
        }
      }
      try {
        const loaded = await this.backend.load(this.userId);
        await this.save((data) => {
          const problem = data.queue.find((m) => m.status !== 'pending');
          return {
            ...data,
            ...loaded,
            error: problem && problem.status !== 'pending' ? problem.status : null,
          };
        });
      } catch (error) {
        await this.fail(classify(error));
      }
    });
  }
  private fail(error: Exclude<DataError, null>): Promise<void> {
    return this.save((data) => ({
      ...data,
      error,
      ...(error === 'denied'
        ? { snapshot: null, profile: null }
        : error === 'invalid-data'
          ? { snapshot: null }
          : {}),
    })).catch(() => {});
  }
  clear(): Promise<void> {
    return this.serialize(async () => {
      await this.storage.clear();
      this.publish(emptyData());
    });
  }
}
