import { PoolClient } from "pg";
import { ensurePanelSchema, getPool } from "@/lib/db";
import {
  DEFAULT_ROLE_REACTION_CONFIG,
  DEFAULT_VOICE_CREATOR_CONFIG,
  FEATURE_KEY_ROLES_REACTION,
  FEATURE_KEY_VOICE_CREATOR,
  FeatureRecord,
  RoleReactionEntry,
  RoleReactionFeatureConfig,
  VoiceCreatorFeatureConfig,
} from "@/lib/types";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringRaw(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeEnabled(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
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

export function normalizeVoiceCreatorConfig(input: unknown): VoiceCreatorFeatureConfig {
  const source = (input || {}) as Partial<VoiceCreatorFeatureConfig>;
  const delayValue =
    typeof source.emptyDeleteDelayMs === "number"
      ? source.emptyDeleteDelayMs
      : Number(source.emptyDeleteDelayMs);
  const emptyDeleteDelayMs = Number.isFinite(delayValue)
    ? Math.max(1000, Math.min(120_000, Math.floor(delayValue)))
    : DEFAULT_VOICE_CREATOR_CONFIG.emptyDeleteDelayMs;

  const rawPrefix = asStringRaw(
    source.tempVoiceNamePrefix,
    DEFAULT_VOICE_CREATOR_CONFIG.tempVoiceNamePrefix
  );
  const trimmedPrefix = rawPrefix.trim();
  const tempVoiceNamePrefix = trimmedPrefix.length > 0 ? trimmedPrefix : "";
  const prefixWithSpace =
    tempVoiceNamePrefix.length === 0
      ? DEFAULT_VOICE_CREATOR_CONFIG.tempVoiceNamePrefix
      : /\s$/.test(tempVoiceNamePrefix)
        ? tempVoiceNamePrefix
        : `${tempVoiceNamePrefix} `;

  return {
    creatorChannelId: asString(
      source.creatorChannelId,
      DEFAULT_VOICE_CREATOR_CONFIG.creatorChannelId
    ),
    targetCategoryId: asString(
      source.targetCategoryId,
      DEFAULT_VOICE_CREATOR_CONFIG.targetCategoryId
    ),
    emptyDeleteDelayMs,
    tempVoiceNamePrefix: prefixWithSpace.slice(0, 60),
  };
}

async function getFeatureRecord<TConfig>({
  guildId,
  featureKey,
  normalizeConfig,
}: {
  guildId: string;
  featureKey: string;
  normalizeConfig: (value: unknown) => TConfig;
}): Promise<FeatureRecord<TConfig>> {
  await ensurePanelSchema();

  const result = await getPool().query(
    `
      SELECT enabled, config_json, updated_at
      FROM panel_feature_configs
      WHERE guild_id = $1 AND feature_key = $2
      LIMIT 1
    `,
    [guildId, featureKey]
  );

  const row = result.rows[0];
  return {
    guildId,
    featureKey,
    enabled: normalizeEnabled(row?.enabled, true),
    config: normalizeConfig(row?.config_json),
    updatedAt: row?.updated_at
      ? new Date(row.updated_at).toISOString()
      : new Date().toISOString(),
  };
}

async function saveFeatureRecord<TConfig>({
  guildId,
  featureKey,
  enabled,
  config,
  updatedBy,
  normalizeConfig,
}: {
  guildId: string;
  featureKey: string;
  enabled: boolean;
  config: TConfig;
  updatedBy: string;
  normalizeConfig: (value: unknown) => TConfig;
}): Promise<FeatureRecord<TConfig>> {
  await ensurePanelSchema();
  const normalizedConfig = normalizeConfig(config);

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
    [guildId, featureKey, enabled, JSON.stringify(normalizedConfig), updatedBy]
  );

  const row = result.rows[0];
  return {
    guildId,
    featureKey,
    enabled: normalizeEnabled(row?.enabled, true),
    config: normalizeConfig(row?.config_json),
    updatedAt: new Date(row?.updated_at || Date.now()).toISOString(),
  };
}

export async function getRolesReactionRecord(
  guildId: string
): Promise<FeatureRecord<RoleReactionFeatureConfig>> {
  return getFeatureRecord({
    guildId,
    featureKey: FEATURE_KEY_ROLES_REACTION,
    normalizeConfig: normalizeRoleReactionConfig,
  });
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
  return saveFeatureRecord({
    guildId,
    featureKey: FEATURE_KEY_ROLES_REACTION,
    enabled,
    config,
    updatedBy,
    normalizeConfig: normalizeRoleReactionConfig,
  });
}

export async function getVoiceCreatorRecord(
  guildId: string
): Promise<FeatureRecord<VoiceCreatorFeatureConfig>> {
  return getFeatureRecord({
    guildId,
    featureKey: FEATURE_KEY_VOICE_CREATOR,
    normalizeConfig: normalizeVoiceCreatorConfig,
  });
}

export async function saveVoiceCreatorRecord({
  guildId,
  enabled,
  config,
  updatedBy,
}: {
  guildId: string;
  enabled: boolean;
  config: VoiceCreatorFeatureConfig;
  updatedBy: string;
}): Promise<FeatureRecord<VoiceCreatorFeatureConfig>> {
  return saveFeatureRecord({
    guildId,
    featureKey: FEATURE_KEY_VOICE_CREATOR,
    enabled,
    config,
    updatedBy,
    normalizeConfig: normalizeVoiceCreatorConfig,
  });
}

export async function withPgConnection<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
