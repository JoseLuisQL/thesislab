import { asc, desc, eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { EntityId, Repository } from '../contracts.js';
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
    const table = this.table as typeof this.table & {
      thesisId?: unknown;
      createdAt?: unknown;
      id: unknown;
    };

    if (!('thesisId' in table)) {
      return [] as TRecord[];
    }

    const createdAtColumn = 'createdAt' in table ? (table.createdAt as never) : undefined;

    const query = this.db
      .select()
      .from(table)
      .where(eq(table.thesisId as never, thesisId));

    const rows = createdAtColumn
      ? query.orderBy(desc(createdAtColumn)).all()
      : query.orderBy(asc(table.id as never)).all();

    return (await rows) as unknown as TRecord[];
  }
}
