import { randomUUID } from 'node:crypto';

import type { EntityId, PersistenceHelpers } from '../contracts.js';

export function createEntityId(): EntityId {
  return randomUUID();
}

export function createTimestamp(now = new Date()): string {
  return now.toISOString();
}

export function createPersistenceHelpers(): PersistenceHelpers {
  return {
    createId: createEntityId,
    now: createTimestamp,
  };
}
