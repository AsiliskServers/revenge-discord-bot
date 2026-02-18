import { Pool } from "pg";

let pool: Pool | null = null;
let schemaReady = false;

function getDatabaseUrl(): string {
  const url = process.env.PANEL_DATABASE_URL;
  if (!url) {
    throw new Error("PANEL_DATABASE_URL est requis");
  }
  return url;
}

export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const sslEnabled = process.env.PANEL_DATABASE_SSL === "1";
  pool = new Pool({
    connectionString: getDatabaseUrl(),
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    max: 6,
  });

  return pool;
}

export async function ensurePanelSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS panel_feature_configs (
      guild_id TEXT NOT NULL,
      feature_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, feature_key)
    );
  `);

  schemaReady = true;
}
