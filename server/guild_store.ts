// Guild persistence — durable guilds (GDD v0.5 §1). Same shape as the CharacterStore: Postgres via
// DATABASE_URL, or an in-memory no-op fallback so local dev runs without a DB. Every query is
// error-guarded — a DB outage LOGS and degrades (guilds just stop persisting), NEVER crashes the game.
// Keyed by guild name (the persistent identity, like character saves).
import { Pool } from 'pg';
import type { Guild } from './guilds';

export interface GuildStore {
  readonly ready: boolean; // true when a DB is connected (false = memory mode)
  loadAll(): Promise<Guild[]>; // every persisted guild (for boot)
  save(guild: Guild): Promise<void>; // upsert one guild
  remove(name: string): Promise<void>; // drop a dissolved guild
  close(): Promise<void>;
}

// No-DB fallback: guilds live only in memory for the session (as before persistence).
export class MemoryGuildStore implements GuildStore {
  readonly ready = false;
  async loadAll(): Promise<Guild[]> { return []; }
  async save(): Promise<void> { /* no-op */ }
  async remove(): Promise<void> { /* no-op */ }
  async close(): Promise<void> { /* nothing */ }
}

class PostgresGuildStore implements GuildStore {
  ready = false;
  private pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url });
    this.pool.on('error', (err) => console.error('[guildstore] pool error (ignored):', err.message));
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS guilds (
        name       TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        members    JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    this.ready = true;
  }

  async loadAll(): Promise<Guild[]> {
    try {
      const res = await this.pool.query('SELECT name, owner, members FROM guilds');
      return res.rows.map((r) => ({
        name: String(r.name),
        owner: String(r.owner),
        members: Array.isArray(r.members) ? (r.members as unknown[]).map(String) : [],
      }));
    } catch (err) {
      console.error('[guildstore] loadAll failed — starting with no guilds:', (err as Error).message);
      return []; // degrade: boot with no guilds rather than crash
    }
  }

  async save(guild: Guild): Promise<void> {
    try {
      // node-pg JSON-encodes the members array for the JSONB column.
      await this.pool.query(
        `INSERT INTO guilds (name, owner, members, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, members = EXCLUDED.members, updated_at = now()`,
        [guild.name, guild.owner, JSON.stringify(guild.members)],
      );
    } catch (err) {
      console.error(`[guildstore] save failed for "${guild.name}":`, (err as Error).message);
    }
  }

  async remove(name: string): Promise<void> {
    try {
      await this.pool.query('DELETE FROM guilds WHERE name = $1', [name]);
    } catch (err) {
      console.error(`[guildstore] remove failed for "${name}":`, (err as Error).message);
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => {});
  }
}

// Build the guild store from DATABASE_URL (Postgres) or fall back to memory. Mirrors createStore.
export async function createGuildStore(databaseUrl: string | undefined): Promise<GuildStore> {
  if (!databaseUrl) return new MemoryGuildStore();
  const store = new PostgresGuildStore(databaseUrl);
  try {
    await store.init();
    console.log('[guildstore] persistence ON — table "guilds" ready');
    return store;
  } catch (err) {
    console.error('[guildstore] could NOT init — guilds will not persist this run:', (err as Error).message);
    await store.close();
    return new MemoryGuildStore();
  }
}
