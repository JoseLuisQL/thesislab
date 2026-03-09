import { asc, desc, eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { EntityId, Repository, ThesisScopedRecord } from '../contracts.js';
import type { ThesisDbClient } from '../client.js';

type TableWithId = SQLiteTable;

export class GenericSqliteRepository<TRecord> implements Repository<TRecord> {
  constructor(
    protected readonly db: ThesisDbClient,
    protected readonly table: TableWithId,
  ) {}

  async findById(id: EntityId) {
    const table = this.table as typeof this.table & { id: unknown };
    const row = this.db
      .select()
      .from(table)
      .where(eq(table.id as never, id))
      .limit(1)
      .get();

    return (row ?? null) as TRecord | null;
  }

  async listByThesisId(thesisId: EntityId) {
    return listByThesisId(this.db, this.table, thesisId) as Promise<TRecord[]>;
  }
}

export function listByThesisId<TRecord extends ThesisScopedRecord>(
  db: ThesisDbClient,
  table: TableWithId,
  thesisId: EntityId,
): Promise<TRecord[]> {
  const thesisScopedTable = table as typeof table & {
    thesisId?: unknown;
    createdAt?: unknown;
    id: unknown;
  };

  if (!('thesisId' in thesisScopedTable)) {
    return Promise.resolve([] as TRecord[]);
  }

  const createdAtColumn = 'createdAt' in thesisScopedTable
    ? (thesisScopedTable.createdAt as never)
    : undefined;

  const query = db
    .select()
    .from(thesisScopedTable)
    .where(eq(thesisScopedTable.thesisId as never, thesisId));

  const rows = createdAtColumn
    ? query.orderBy(desc(createdAtColumn), asc(thesisScopedTable.id as never)).all()
    : query.orderBy(asc(thesisScopedTable.id as never)).all();

  return rows as unknown as Promise<TRecord[]>;
}
