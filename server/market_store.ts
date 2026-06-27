// Marketplace persistence — the global listings + mailbox, as a SINGLE-ROW JSONB blob (id=1). This is
// what makes the marketplace ASYNC: a sale to an offline seller (proceeds in the mailbox) + the escrowed
// listings survive a server restart. Memory fallback + error-guarded, exactly like the CharacterStore —
// a DB outage logs and degrades (the market just won't persist), NEVER crashes the game.
import { Pool } from 'pg';

export interface MarketStore {
  readonly ready: boolean;
  load(): Promise<unknown | null>; // the saved blob (UNTRUSTED — the Sim sanitizes it on restore), or null
  save(blob: unknown): Promise<void>; // upsert the whole market state
  close(): Promise<void>;
}

export class MemoryMarketStore implements MarketStore {
  readonly ready = false;
  async load(): Promise<unknown | null> { return null; }
  async save(): Promise<void> { /* no-op */ }
  async close(): Promise<void> { /* nothing */ }
}

class PostgresMarketStore implements MarketStore {
  ready = false;
  private pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url });
    this.pool.on('error', (err) => console.error('[marketstore] pool error (ignored):', err.message));
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS market_state (
        id         INT PRIMARY KEY,
        state      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    this.ready = true;
  }

  async load(): Promise<unknown | null> {
    try {
      const res = await this.pool.query('SELECT state FROM market_state WHERE id = 1');
      return res.rows.length > 0 ? res.rows[0].state : null;
    } catch (err) {
      console.error('[marketstore] load failed — starting with an empty market:', (err as Error).message);
      return null;
    }
  }

  async save(blob: unknown): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO market_state (id, state, updated_at) VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [JSON.stringify(blob)],
      );
    } catch (err) {
      console.error('[marketstore] save failed:', (err as Error).message);
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => {});
  }
}

export async function createMarketStore(databaseUrl: string | undefined): Promise<MarketStore> {
  if (!databaseUrl) return new MemoryMarketStore();
  const store = new PostgresMarketStore(databaseUrl);
  try {
    await store.init();
    console.log('[marketstore] persistence ON — table "market_state" ready');
    return store;
  } catch (err) {
    console.error('[marketstore] could NOT init — marketplace will not persist this run:', (err as Error).message);
    await store.close();
    return new MemoryMarketStore();
  }
}
