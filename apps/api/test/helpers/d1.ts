/**
 * A D1-compatible database backed by real SQLite, running the project's real migrations.
 *
 * The `MockD1Database` in e2e.test.ts answers queries by matching substrings of the SQL. That is
 * fine for the services it was written for, but it cannot test the ones added in phases 1–5:
 * their correctness *is* the SQL — `ON CONFLICT(idempotency_key) DO NOTHING`, `SUM(points_delta)`
 * over a ledger, `seats_booked < seats_total` guards, batched multi-statement writes. A stub that
 * returns `{ success: true }` for every `run()` would report those as working no matter what.
 *
 * `node:sqlite` ships with Node 22 (the version CI pins), so this needs no new dependency.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Walks up from the working directory to find the migrations. `npm test` runs from `apps/api`
 * via the workspace but a bare `npx tsx` may run from the repo root, and tsx resolves this file
 * as CJS, so neither a cwd-relative path nor `import.meta.url` is dependable.
 */
function findMigrationsDir(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'packages', 'db', 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate packages/db/migrations from ${process.cwd()}`);
}

const MIGRATIONS_DIR = findMigrationsDir();

/**
 * D1's `run()`/`all()` report affected rows in `meta.changes`, and several services branch on it
 * (`expireStaleGrants` returns it; `expireStaleHolds` uses it to detect a lost race). Anything
 * that leaves it undefined turns those branches into silent no-ops.
 */
export interface D1Result<T = any> {
  results: T[];
  success: true;
  meta: { changes: number; last_row_id: number; duration: number };
}

class Statement {
  private params: unknown[] = [];

  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}

  bind(...params: unknown[]): Statement {
    // D1 accepts booleans and undefined; node:sqlite accepts neither.
    this.params = params.map((p) => {
      if (typeof p === 'boolean') return p ? 1 : 0;
      if (p === undefined) return null;
      return p;
    });
    return this;
  }

  async first<T = any>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as any[])) as any;
    if (row === undefined) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = any>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.sql).all(...(this.params as any[])) as T[];
    return { results: rows, success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
  }

  async run<T = any>(): Promise<D1Result<T>> {
    const info = this.db.prepare(this.sql).run(...(this.params as any[]));
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(info.changes ?? 0),
        last_row_id: Number(info.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }

  /** For batch(): the same work, synchronously, so it can run inside one transaction. */
  execSync(): D1Result {
    const prepared = this.db.prepare(this.sql);
    // node:sqlite refuses .run() on a statement that returns rows, and vice versa; the services
    // batch both kinds, so pick by whether the statement produces a result set.
    if (/^\s*(select|with)\b/i.test(this.sql)) {
      const rows = prepared.all(...(this.params as any[])) as any[];
      return { results: rows, success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
    }
    const info = prepared.run(...(this.params as any[]));
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(info.changes ?? 0),
        last_row_id: Number(info.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }
}

export class TestD1 {
  readonly sqlite: DatabaseSync;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    applyMigrations(this.sqlite);
  }

  prepare(sql: string): Statement {
    return new Statement(this.sqlite, sql);
  }

  /**
   * D1 runs a batch inside an implicit transaction. Several invariants depend on that and on
   * nothing else — a points redemption writes the ledger row, the lot allocations and the
   * customer rollup as one batch, and a partial application would leave the rollup disagreeing
   * with the ledger. Looping the statements without a transaction would let those tests pass
   * while the invariant stayed broken in production.
   */
  async batch(statements: Statement[]): Promise<D1Result[]> {
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map((s) => s.execSync());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }

  /** Test-only escape hatch for arranging fixtures without going through a service. */
  run(sql: string, ...params: unknown[]): void {
    this.sqlite.prepare(sql).run(...(params as any[]));
  }

  get<T = any>(sql: string, ...params: unknown[]): T | undefined {
    const row = this.sqlite.prepare(sql).get(...(params as any[]));
    return row === undefined ? undefined : (plain(row) as T);
  }

  select<T = any>(sql: string, ...params: unknown[]): T[] {
    return (this.sqlite.prepare(sql).all(...(params as any[])) as any[]).map(plain) as T[];
  }
}

/**
 * Splits a migration on statement boundaries and applies it.
 *
 * `0004_subscription_columns.sql` re-adds columns an earlier migration already created, so it
 * fails against a fresh database. Production has it applied and recorded, so it must not be
 * "fixed" — it is tolerated here, and *only* that error is. A blanket catch would let a genuinely
 * broken future migration load as an empty schema with every test still green.
 */
function applyMigrations(db: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`No migrations found at ${MIGRATIONS_DIR}`);

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of splitStatements(sql)) {
      try {
        db.exec(statement);
      } catch (err: any) {
        if (/duplicate column name/i.test(String(err?.message))) continue;
        throw new Error(`${file}: ${err?.message}\n--- statement ---\n${statement.slice(0, 400)}`);
      }
    }
  }
}

/**
 * `node:sqlite` returns null-prototype rows, which `assert.deepEqual` reports as unequal to an
 * object literal even when every field matches. Only the test-only readers below convert; the
 * D1 surface leaves rows exactly as the services will see them.
 */
function plain<T extends object>(row: T): T {
  return { ...row };
}

/**
 * Splits on `;`, ignoring separators and `--` comments that fall inside a string literal.
 *
 * A line-wise regex strip cannot do this: the seed rows in `0016` contain prose with both
 * semicolons and double hyphens, and cutting them produces SQL that fails to parse. The
 * migrations contain no triggers or BEGIN…END blocks, so `;` is otherwise a real boundary.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (inString) {
      current += ch;
      // '' is an escaped quote inside a string, not the end of one.
      if (ch === "'") {
        if (sql[i + 1] === "'") { current += sql[++i]; } else { inString = false; }
      }
      continue;
    }

    if (ch === "'") { inString = true; current += ch; continue; }

    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += '\n';
      continue;
    }

    if (ch === ';') { statements.push(current); current = ''; continue; }
    current += ch;
  }
  statements.push(current);

  return statements.map((s) => s.trim()).filter(Boolean);
}

/** A customer row, since every ledger table has a foreign key to one. */
export function seedCustomer(
  db: TestD1,
  id = 'cust_test',
  email = 'tester@dailyroast.in'
): { id: string; email: string } {
  db.run(
    'INSERT INTO customers (id, email, full_name, loyalty_points) VALUES (?, ?, ?, 0)',
    id,
    email,
    'Test Customer'
  );
  return { id, email };
}

/**
 * A category, product and variant. The real catalog lives in `packages/db/seeds`, which is not a
 * migration, so anything with a foreign key to a variant — a subscription, an order line — has
 * to build one. Every NOT NULL column in `products` is filled in here rather than at each call
 * site, which is why this lives beside the adapter.
 */
export function seedProductVariant(
  db: TestD1,
  opts: { variantId?: string; priceCents?: number; sku?: string } = {}
): { productId: string; variantId: string } {
  const variantId = opts.variantId ?? 'var_test';
  const productId = `prod_${variantId}`;

  if (!db.get('SELECT id FROM categories WHERE id = ?', 'cat_test')) {
    db.run(`INSERT INTO categories (id, slug, name, display_order) VALUES ('cat_test', 'test', 'Test', 1)`);
  }

  db.run(
    `INSERT INTO products (id, slug, name, description, category_id, origin_country, region,
                           process_method, roast_level, tasting_notes, image_url, is_active)
     VALUES (?, ?, 'Test Lot', 'A lot for tests', 'cat_test', 'India', 'Chikmagalur',
             'WASHED', 'MEDIUM', '["Cocoa"]', 'https://example.com/x.jpg', 1)`,
    productId, `test-lot-${variantId}`
  );
  db.run(
    `INSERT INTO product_variants (id, product_id, sku, weight_grams, price_cents, grind_options, is_active)
     VALUES (?, ?, ?, 250, ?, '["WHOLE_BEAN"]', 1)`,
    variantId, productId, opts.sku ?? `TDG-TEST-${variantId}`, opts.priceCents ?? 95_000
  );

  return { productId, variantId };
}

/** Minimal env for the services that take one rather than a bare DB. */
export function testEnv(db: TestD1, overrides: Record<string, unknown> = {}): any {
  return {
    DB: db,
    ENVIRONMENT: 'test',
    STOREFRONT_URL: 'https://dailyroast.in',
    CURRENCY: 'inr',
    ...overrides,
  };
}
