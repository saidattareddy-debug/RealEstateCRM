/**
 * Minimal in-memory Supabase-shaped client for apps/web server tests. Supports
 * the chained calls the canonical ingestion service uses:
 *   from(t).insert(obj).select(cols).single()
 *   from(t).update(obj).eq(c, v)
 *   from(t).select(cols).eq(c, v).eq(c, v).maybeSingle()
 * It enforces per-table UNIQUE constraints (a conflict yields `{ code: '23505' }`)
 * with NULL columns excluded from uniqueness (Postgres semantics).
 */

type Row = Record<string, unknown>;

// Composite UNIQUE constraints we model for the tables under test.
const UNIQUES: Record<string, string[][]> = {
  message_ingestion_events: [['tenant_id', 'idempotency_key']],
  conversation_messages: [['tenant_id', 'external_message_id']],
  external_event_envelopes: [['tenant_id', 'receipt_idempotency_key']],
  external_events: [['tenant_id', 'idempotency_key']],
};

let idSeq = 1;

export interface FakeDb {
  tables: Record<string, Row[]>;
}

function conflict(db: FakeDb, table: string, row: Row): boolean {
  const uniques = UNIQUES[table] ?? [];
  return uniques.some((cols) => {
    if (cols.some((c) => row[c] === null || row[c] === undefined)) return false;
    return (db.tables[table] ?? []).some((existing) => cols.every((c) => existing[c] === row[c]));
  });
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: 'insert' | 'update' | 'select' = 'select';
  private payload: Row | null = null;
  private filters: Array<[string, unknown]> = [];
  private isFilters: Array<[string, unknown]> = [];
  private orderSpec: { col: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private wantSingle = false;
  private wantMaybe = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  insert(obj: Row) {
    this.op = 'insert';
    this.payload = obj;
    return this;
  }
  update(obj: Row) {
    this.op = 'update';
    this.payload = obj;
    return this;
  }
  select(_cols?: string) {
    if (this.op !== 'insert' && this.op !== 'update') this.op = 'select';
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  /** `.is(col, null)` — NULL-aware equality (null and undefined are equal). */
  is(col: string, val: unknown) {
    this.isFilters.push([col, val]);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderSpec = { col, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.wantSingle = true;
    return this.run();
  }
  maybeSingle() {
    this.wantMaybe = true;
    return this.run();
  }

  private rows(): Row[] {
    let out = (this.db.tables[this.table] ?? []).filter(
      (r) =>
        this.filters.every(([c, v]) => r[c] === v) &&
        // NULL-aware: `.is(col, null)` matches null AND undefined.
        this.isFilters.every(([c, v]) => (r[c] ?? null) === (v ?? null)),
    );
    if (this.orderSpec) {
      const { col, ascending } = this.orderSpec;
      out = [...out].sort((a, b) => {
        const av = a[col] as never;
        const bv = b[col] as never;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }

  private run(): Promise<{ data: unknown; error: unknown }> {
    if (this.op === 'insert' && this.payload) {
      if (conflict(this.db, this.table, this.payload)) {
        return Promise.resolve({ data: null, error: { code: '23505' } });
      }
      const row: Row = { id: `id_${idSeq++}`, ...this.payload };
      (this.db.tables[this.table] ??= []).push(row);
      return Promise.resolve({ data: { id: row.id, ...row }, error: null });
    }
    if (this.op === 'update' && this.payload) {
      for (const r of this.rows()) Object.assign(r, this.payload);
      return Promise.resolve({ data: null, error: null });
    }
    const found = this.rows();
    if (this.wantSingle || this.wantMaybe) {
      return Promise.resolve({ data: found[0] ?? null, error: null });
    }
    return Promise.resolve({ data: found, error: null });
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export function makeFakeAdmin(db: FakeDb = { tables: {} }) {
  const client = {
    from(table: string) {
      return new FakeQuery(db, table);
    },
  };
  return { client: client as never, db };
}

export function rowCount(db: FakeDb, table: string): number {
  return (db.tables[table] ?? []).length;
}
