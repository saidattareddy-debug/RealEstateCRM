import type { Pool } from 'pg';

/**
 * Postgres-backed Supabase-client shim for embedded-PG service tests.
 *
 * Implements the subset of the supabase-js query builder the canonical ingestion
 * services use (from/select/insert/update/delete/eq/in/is/order/limit/single/
 * maybeSingle), including PostgREST **embedded-relationship** selects
 * (`table!inner(cols)` / `table(cols)` with `embed.col` filters), translating each
 * chain to parameterized SQL against a real `pg` pool. The pool connects as the DB
 * owner, mirroring the service-role admin client (RLS bypassed) — so triggers,
 * constraints, defaults and idempotency all execute for real. Tests only.
 */

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message?: string } | null };

interface Rel {
  fk: string;
  refTable: string;
  refPk: string;
}
// Relationship registry: base table → embed name → join definition. Extend as
// services use more embeds. Covers the embeds in ingestLead / processLead.
const REL: Record<string, Record<string, Rel>> = {
  pipeline_stages: { pipelines: { fk: 'pipeline_id', refTable: 'pipelines', refPk: 'id' } },
  leads: { lead_sources: { fk: 'source_id', refTable: 'lead_sources', refPk: 'id' } },
  memberships: { roles: { fk: 'role_id', refTable: 'roles', refPk: 'id' } },
};

function sqlVal(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

interface Embed {
  name: string;
  inner: boolean;
  sub: string[];
}
function parseCols(cols: string): { plain: string[]; embeds: Embed[] } {
  const plain: string[] = [];
  const embeds: Embed[] = [];
  let depth = 0;
  let cur = '';
  const toks: string[] = [];
  for (const ch of cols) {
    if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      toks.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) toks.push(cur);
  for (const raw of toks) {
    const t = raw.trim();
    const m = t.match(/^([a-z_]+)(!inner)?\((.*)\)$/);
    if (m) embeds.push({ name: m[1]!, inner: !!m[2], sub: m[3]!.split(',').map((s) => s.trim()) });
    else if (t) plain.push(t);
  }
  return { plain, embeds };
}

class PgQuery implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private cols = '*';
  private filters: Array<{ col: string; op: '=' | 'in' | 'is'; val: unknown }> = [];
  private limitN: number | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private one = false;
  private maybe = false;
  private countMode: string | null = null;

  constructor(
    private pool: Pool,
    private table: string,
  ) {}

  insert(obj: Row | Row[]) {
    this.op = 'insert';
    this.payload = obj;
    return this;
  }
  update(obj: Row) {
    this.op = 'update';
    this.payload = obj;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    this.cols = cols || '*';
    if (opts?.count) this.countMode = opts.count;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ col, op: '=', val });
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push({ col, op: 'in', val: vals });
    return this;
  }
  is(col: string, val: null) {
    this.filters.push({ col, op: 'is', val });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.one = true;
    this.limitN = this.limitN ?? 1;
    return this.run();
  }
  maybeSingle() {
    this.maybe = true;
    this.limitN = this.limitN ?? 1;
    return this.run();
  }
  then<R1 = Result, R2 = never>(
    onfulfilled?: ((v: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  /** WHERE builder for insert/update/delete (no embeds, no base alias). */
  private where(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    const parts = this.filters.map((f) => {
      if (f.op === 'is') return `"${f.col}" is null`;
      if (f.op === 'in') {
        const arr = f.val as unknown[];
        const ph = arr.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `"${f.col}" in (${ph.join(',')})`;
      }
      params.push(f.val);
      return `"${f.col}" = $${params.length}`;
    });
    return ' where ' + parts.join(' and ');
  }

  private async run(): Promise<Result> {
    try {
      if (this.op === 'insert') return await this.runInsert();
      if (this.op === 'update') return await this.runUpdate();
      if (this.op === 'delete') return await this.runDelete();
      return await this.runSelect();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { data: null, error: { code: err.code, message: err.message } };
    }
  }

  private async runInsert(): Promise<Result> {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
    const first = rows[0];
    if (!first) return { data: [], error: null };
    const cols = Object.keys(first);
    const params: unknown[] = [];
    const tuples = rows.map((r) => {
      const ph = cols.map((c) => {
        params.push(sqlVal(r[c]));
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    const colList = cols.map((c) => `"${c}"`).join(',');
    const ret = this.cols && this.cols !== '*' ? this.cols : '*';
    const sql = `insert into "${this.table}" (${colList}) values ${tuples.join(',')} returning ${ret}`;
    const res = await this.pool.query(sql, params);
    if (this.one || this.maybe) return { data: res.rows[0] ?? null, error: null };
    return { data: res.rows, error: null };
  }

  private async runUpdate(): Promise<Result> {
    const obj = this.payload as Row;
    const cols = Object.keys(obj);
    const params: unknown[] = [];
    const sets = cols.map((c) => {
      params.push(sqlVal(obj[c]));
      return `"${c}" = $${params.length}`;
    });
    const where = this.where(params);
    const ret = this.cols && this.cols !== '*' ? this.cols : '*';
    const sql = `update "${this.table}" set ${sets.join(',')}${where} returning ${ret}`;
    const res = await this.pool.query(sql, params);
    if (this.one || this.maybe) return { data: res.rows[0] ?? null, error: null };
    return { data: res.rows, error: null };
  }

  private async runDelete(): Promise<Result> {
    const params: unknown[] = [];
    const where = this.where(params);
    await this.pool.query(`delete from "${this.table}"${where}`, params);
    return { data: null, error: null };
  }

  private async runSelect(): Promise<Result> {
    const { plain, embeds } = parseCols(this.cols);
    const rels = REL[this.table] ?? {};
    const aliasOf: Record<string, string> = {};
    const joins: string[] = [];
    embeds.forEach((e, i) => {
      const rel = rels[e.name];
      if (!rel) throw new Error(`pg-shim: unknown embed ${this.table}.${e.name}`);
      const a = `e${i}`;
      aliasOf[e.name] = a;
      joins.push(
        `${e.inner ? 'inner' : 'left'} join "${rel.refTable}" ${a} on ${a}."${rel.refPk}" = b."${rel.fk}"`,
      );
    });

    const selectParts: string[] = [];
    if (plain.length === 1 && plain[0] === '*' && embeds.length === 0) selectParts.push('b.*');
    else {
      for (const p of plain) selectParts.push(p === '*' ? 'b.*' : `b."${p}"`);
      embeds.forEach((e) => {
        const a = aliasOf[e.name];
        const obj = e.sub.map((s) => `'${s}', ${a}."${s}"`).join(',');
        selectParts.push(
          `(case when ${a}."${rels[e.name]!.refPk}" is null then null else json_build_object(${obj}) end) as "${e.name}"`,
        );
      });
    }

    const params: unknown[] = [];
    const wparts = this.filters.map((f) => {
      let lhs: string;
      if (f.col.includes('.')) {
        const [en, c] = f.col.split('.');
        lhs = `${aliasOf[en!]}."${c}"`;
      } else lhs = `b."${f.col}"`;
      if (f.op === 'is') return `${lhs} is null`;
      if (f.op === 'in') {
        const arr = f.val as unknown[];
        const ph = arr.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `${lhs} in (${ph.join(',')})`;
      }
      params.push(f.val);
      return `${lhs} = $${params.length}`;
    });
    const where = wparts.length ? ' where ' + wparts.join(' and ') : '';

    // `.select(cols, { count: 'exact', head: true })` → return a row count.
    if (this.countMode) {
      const csql = `select count(*)::int c from "${this.table}" b ${joins.join(' ')}${where}`;
      const cres = await this.pool.query(csql, params);
      const count = (cres.rows[0]?.c as number) ?? 0;
      return { count, data: null, error: null } as unknown as Result;
    }

    const order = this.orderBy
      ? ` order by b."${this.orderBy.col}" ${this.orderBy.asc ? 'asc' : 'desc'}`
      : '';
    const limit = this.limitN != null ? ` limit ${this.limitN}` : '';
    const sql = `select ${selectParts.join(',')} from "${this.table}" b ${joins.join(' ')}${where}${order}${limit}`;
    const res = await this.pool.query(sql, params);
    if (this.one || this.maybe) return { data: res.rows[0] ?? null, error: null };
    return { data: res.rows, error: null };
  }
}

/** Build a Supabase-shaped client backed by a real pg pool. */
export function makePgSupabase(pool: Pool) {
  return {
    from(table: string) {
      return new PgQuery(pool, table);
    },
  } as never;
}
