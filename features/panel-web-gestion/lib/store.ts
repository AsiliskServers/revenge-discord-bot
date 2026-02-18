import { PoolClient } from "pg";
import { ensurePanelSchema, getPool } from "@/lib/db";
import {
  DEFAULT_ROLE_REACTION_CONFIG,
  FEATURE_KEY_ROLES_REACTION,
  FeatureRecord,
  RoleReactionEntry,
  RoleReactionFeatureConfig,
} from "@/lib/types";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function sanitizeRoleEntry(input: unknown, index: number): RoleReactionEntry {
  const source = (input || {}) as Partial<RoleReactionEntry>;
  const key = asString(source.key, `role_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || `role_${index + 1}`;

  return {
    key,
    label: asString(source.label, `Rôle ${index + 1}`),
    roleId: asString(source.roleId),
  };
}

export function normalizeRoleReactionConfig(input: unknown): RoleReactionFeatureConfig {
  const source = (input || {}) as Partial<RoleReactionFeatureConfig>;
  const rawRoles = Array.isArray(source.roles) ? source.roles : DEFAULT_ROLE_REACTION_CONFIG.roles;
  const roles = rawRoles
    .slice(0, 5)
    .map((entry, index) => sanitizeRoleEntry(entry, index))
    .filter((entry) => entry.roleId.length > 0 && entry.label.length > 0);

  return {
    channelId: asString(source.channelId, DEFAULT_ROLE_REACTION_CONFIG.channelId),
    roles: roles.length > 0 ? roles : DEFAULT_ROLE_REACTION_CONFIG.roles,
  };
}

function normalizeEnabled(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

export async function getRolesReactionRecord(guildId: string): Promise<FeatureRecord<RoleReactionFeatureConfig>> {
  await ensurePanelSchema();

  const result = await getPool().query(
    `
      SELECT enabled, config_json, updated_at
      FROM panel_feature_configs
      WHERE guild_id = $1 AND feature_key = $2
      LIMIT 1
    `,
    [guildId, FEATURE_KEY_ROLES_REACTION]
  );

  const row = result.rows[0];
  const enabled = normalizeEnabled(row?.enabled, true);
  const config = normalizeRoleReactionConfig(row?.config_json);
  const updatedAt = row?.updated_at
    ? new Date(row.updated_at).toISOString()
    : new Date().toISOString();

  return {
    guildId,
    featureKey: FEATURE_KEY_ROLES_REACTION,
    enabled,
    config,
    updatedAt,
  };
}

export async function saveRolesReactionRecord({
  guildId,
  enabled,
  config,
  updatedBy,
}: {
  guildId: string;
  enabled: boolean;
  config: RoleReactionFeatureConfig;
  updatedBy: string;
}): Promise<FeatureRecord<RoleReactionFeatureConfig>> {
  await ensurePanelSchema();

  const normalizedConfig = normalizeRoleReactionConfig(config);

  const result = await getPool().query(
    `
      INSERT INTO panel_feature_configs (guild_id, feature_key, enabled, config_json, updated_by, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
      ON CONFLICT (guild_id, feature_key)
      DO UPDATE SET
        enabled = EXCLUDED.enabled,
        config_json = EXCLUDED.config_json,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING enabled, config_json, updated_at
    `,
    [guildId, FEATURE_KEY_ROLES_REACTION, enabled, JSON.stringify(normalizedConfig), updatedBy]
  );

  const row = result.rows[0];
  return {
    guildId,
    featureKey: FEATURE_KEY_ROLES_REACTION,
    enabled: normalizeEnabled(row?.enabled, true),
    config: normalizeRoleReactionConfig(row?.config_json),
    updatedAt: new Date(row?.updated_at || Date.now()).toISOString(),
  };
}

export async function withPgConnection<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
