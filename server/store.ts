// Character persistence (the SERVER's responsibility). Saves/loads each character's
// serialized progression keyed by player NAME (no login yet — testing only). Backed by
// Postgres via DATABASE_URL; with NO DATABASE_URL it runs in MEMORY (no persistence) so
// local dev works without a database. Every DB call is wrapped so an error LOGS and
// degrades gracefully — a database outage NEVER crashes the game (it keeps running).
//
// The DATABASE_URL is a secret: it's read from the env and NEVER logged.
import { Pool } from 'pg';
import type { PlayerSave } from '../src/sim/save';

export interface CharacterStore {
  // true when real persistence is active (a DB is connected). false in memory mode.
  readonly ready: boolean;
  // Look up a saved character by name. Returns the raw JSON state (UNTRUSTED — the Sim
  // sanitizes it on restore), or null if there's no save / on any DB error.
  load(name: string): Promise<unknown | null>;
  // Upsert a character's serialized state. Best-effort: logs and continues on error.
  save(name: string, state: PlayerSave): Promise<void>;
  close(): Promise<void>;
}

// No-DB fallback: everything is a no-op, so the game runs purely in memory (as before).
export class MemoryStore implements CharacterStore {
  readonly ready = false;
  async load(): Promise<unknown | null> {
    return null;
  }
  async save(): Promise<void> {
    /* no-op: nothing is persisted without a database */
  }
  async close(): Promise<void> {
    /* nothing to close */
  }
}

// Postgres-backed store. One connection pool; all queries are error-guarded.
class PostgresStore implements CharacterStore {
  ready = false;
  private pool: Pool;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url });
    // An idle client erroring (e.g. the DB restarted) must not crash the process.
    this.pool.on('error', (err) => console.error('[store] pool error (ignored):', err.message));
  }

  // Create the table if missing. Throws if the DB is unreachable — the caller falls back.
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS characters (
        name       TEXT PRIMARY KEY,
        state      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    this.ready = true;
  }

  async load(name: string): Promise<unknown | null> {
    try {
      const res = await this.pool.query('SELECT state FROM characters WHERE name = $1', [name]);
      return res.rows.length > 0 ? res.rows[0].state : null; // JSONB -> parsed JS object
    } catch (err) {
      console.error(`[store] load failed for "${name}" — treating as no save:`, (err as Error).message);
      return null; // degrade: a returning player just starts fresh rather than crashing
    }
  }

  async save(name: string, state: PlayerSave): Promise<void> {
    try {
      // node-pg JSON-encodes the object for the JSONB column.
      await this.pool.query(
        `INSERT INTO characters (name, state, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (name) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [name, state],
      );
    } catch (err) {
      console.error(`[store] save failed for "${name}":`, (err as Error).message);
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => {});
  }
}

// Build the store from DATABASE_URL (Postgres) or fall back to memory. Initializes the
// schema; if init FAILS (DB unreachable at boot), logs and falls back to memory so the
// server still starts. Never logs the URL.
export async function createStore(databaseUrl: string | undefined): Promise<CharacterStore> {
  if (!databaseUrl) {
    console.log('[store] no DATABASE_URL — running WITHOUT persistence (in-memory; progress is NOT saved)');
    return new MemoryStore();
  }
  const store = new PostgresStore(databaseUrl);
  try {
    await store.init();
    console.log('[store] persistence ON — connected to Postgres (table "characters" ready)');
    return store;
  } catch (err) {
    console.error('[store] could NOT init Postgres — falling back to in-memory (no persistence):', (err as Error).message);
    await store.close();
    return new MemoryStore();
  }
}
