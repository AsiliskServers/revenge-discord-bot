const fs = require("node:fs");
const path = require("node:path");
const { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { fetchConfiguredGuild, fetchGuildTextChannel } = require("../_shared/common");

let PgPoolCtor = null;
let RedisCtor = null;

try {
  ({ Pool: PgPoolCtor } = require("pg"));
} catch {
  PgPoolCtor = null;
}

try {
  RedisCtor = require("ioredis");
} catch {
  RedisCtor = null;
}

const FEATURE_KEY = "welcome-message";
const REDIS_CHANNEL = process.env.PANEL_REDIS_CHANNEL || "revenge:feature:update";

const DEFAULT_CONFIG = {
  enabled: true,
  channelId: "996443449744167073",
  titleTargetChannelId: "1349631503730212965",
};

const WELCOME_THUMBNAIL_FILE = "image.png";

const runtime = {
  dbPool: null,
  schemaReady: false,
  redisSubscriber: null,
  pollTimer: null,
  configByGuild: new Map(),
};

function asString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeConfig(rawEnabled, rawConfig) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  return {
    enabled: typeof rawEnabled === "boolean" ? rawEnabled : true,
    channelId: asString(source.channelId, DEFAULT_CONFIG.channelId),
    titleTargetChannelId: asString(
      source.titleTargetChannelId,
      DEFAULT_CONFIG.titleTargetChannelId
    ),
  };
}

function getGuildConfig(guildId) {
  return runtime.configByGuild.get(String(guildId)) || DEFAULT_CONFIG;
}

function getDatabaseUrl() {
  return asString(process.env.PANEL_DATABASE_URL);
}

function canUseDatabase() {
  return Boolean(getDatabaseUrl() && PgPoolCtor);
}

function getDbPool() {
  if (runtime.dbPool) {
    return runtime.dbPool;
  }
  if (!canUseDatabase()) {
    return null;
  }

  runtime.dbPool = new PgPoolCtor({
    connectionString: getDatabaseUrl(),
    ssl: process.env.PANEL_DATABASE_SSL === "1" ? { rejectUnauthorized: false } : undefined,
    max: 4,
  });

  runtime.dbPool.on("error", (error) => {
    console.error("[WELCOME] PostgreSQL pool error");
    console.error(error);
  });

  return runtime.dbPool;
}

async function ensureSchema() {
  const pool = getDbPool();
  if (!pool || runtime.schemaReady) {
    return;
  }

  await pool.query(`
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

  runtime.schemaReady = true;
}

async function loadConfigForGuild(guildId) {
  const pool = getDbPool();
  if (!pool) {
    return DEFAULT_CONFIG;
  }

  try {
    await ensureSchema();
    const result = await pool.query(
      `
        SELECT enabled, config_json
        FROM panel_feature_configs
        WHERE guild_id = $1 AND feature_key = $2
        LIMIT 1
      `,
      [String(guildId), FEATURE_KEY]
    );

    const row = result.rows?.[0];
    if (!row) {
      return DEFAULT_CONFIG;
    }

    return normalizeConfig(row.enabled, row.config_json);
  } catch (error) {
    console.error("[WELCOME] Impossible de charger la config DB, fallback default.");
    console.error(error);
    return DEFAULT_CONFIG;
  }
}

async function refreshGuildConfig(guildId) {
  if (!guildId) {
    return DEFAULT_CONFIG;
  }

  const config = await loadConfigForGuild(guildId);
  runtime.configByGuild.set(String(guildId), config);
  return config;
}

function startRedisSubscription(client) {
  const redisUrl = asString(process.env.PANEL_REDIS_URL);
  if (!redisUrl || !RedisCtor || runtime.redisSubscriber) {
    return;
  }

  const subscriber = new RedisCtor(redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });

  subscriber.on("error", (error) => {
    console.error("[WELCOME] Redis subscriber error");
    console.error(error.message || error);
  });

  subscriber.on("message", async (channel, message) => {
    if (channel !== REDIS_CHANNEL) {
      return;
    }

    try {
      const payload = JSON.parse(message);
      if (payload?.featureKey !== FEATURE_KEY) {
        return;
      }

      const guildId = asString(payload?.guildId);
      if (!guildId) {
        return;
      }
      if (client.config?.guildId && guildId !== client.config.guildId) {
        return;
      }

      if (typeof payload?.enabled === "boolean" || payload?.config) {
        const config = normalizeConfig(payload.enabled, payload.config);
        runtime.configByGuild.set(guildId, config);
        console.info(`[WELCOME] Update Redis applique: enabled=${config.enabled} guild=${guildId}`);
        return;
      }

      await refreshGuildConfig(guildId);
    } catch (error) {
      console.error("[WELCOME] Redis payload invalide");
      console.error(error);
    }
  });

  subscriber.subscribe(REDIS_CHANNEL).catch((error) => {
    console.error("[WELCOME] Impossible de s'abonner au channel Redis");
    console.error(error);
  });

  runtime.redisSubscriber = subscriber;
}

function startDatabasePolling(client) {
  if (runtime.pollTimer || !canUseDatabase()) {
    return;
  }

  runtime.pollTimer = setInterval(() => {
    if (!client.config?.guildId) {
      return;
    }
    void refreshGuildConfig(client.config.guildId);
  }, 45_000);

  if (typeof runtime.pollTimer.unref === "function") {
    runtime.pollTimer.unref();
  }
}

async function resolveTitleUrl(guild, titleTargetChannelId) {
  const channel =
    guild.channels.cache.get(titleTargetChannelId) ||
    (await guild.channels.fetch(titleTargetChannelId).catch(() => null));

  if (!channel) {
    return `https://discord.com/channels/${guild.id}/${titleTargetChannelId}`;
  }

  return channel.url;
}

function buildWelcomeEmbed({ member, titleUrl, botAvatarUrl }) {
  return new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("REVENGE・DISCORD")
    .setURL(titleUrl)
    .setDescription(
      `Bienvenue a toi ${member} chez la REVENGE.\n\n` +
        `C'est un plaisir de t'accueillir, le discord compte desormais ${member.guild.memberCount} personnes ❗\n` +
        "Merci d'agrandir la Famille, installe-toi et profite 🎉"
    )
    .setFooter({
      text: "REVENGE | Bienvenue",
      iconURL: botAvatarUrl || undefined,
    });
}

function canSendWelcome(botMember, channel) {
  const perms = channel.permissionsFor(botMember);
  return {
    canView: Boolean(perms?.has(PermissionFlagsBits.ViewChannel)),
    canSend: Boolean(perms?.has(PermissionFlagsBits.SendMessages)),
    canEmbed: Boolean(perms?.has(PermissionFlagsBits.EmbedLinks)),
    canAttach: Boolean(perms?.has(PermissionFlagsBits.AttachFiles)),
  };
}

module.exports = {
  name: "feature:welcome-embed-on-join",
  async init(client) {
    client.once("clientReady", async () => {
      const hasDbUrl = Boolean(getDatabaseUrl());
      const hasRedisUrl = Boolean(asString(process.env.PANEL_REDIS_URL));
      console.info(
        `[WELCOME] Boot config: db_url=${hasDbUrl ? "yes" : "no"} redis_url=${
          hasRedisUrl ? "yes" : "no"
        }`
      );

      const guild = await fetchConfiguredGuild(client);
      if (!guild) {
        console.warn("[WELCOME] Guild introuvable.");
        return;
      }

      await refreshGuildConfig(guild.id);
      startRedisSubscription(client);
      startDatabasePolling(client);

      if (!hasDbUrl) {
        console.warn("[WELCOME] PANEL_DATABASE_URL absent: lecture DB des settings desactivee.");
      }
      if (!hasRedisUrl) {
        console.warn(
          "[WELCOME] PANEL_REDIS_URL absent: refresh temps reel depuis panel desactive."
        );
      }
      if (!PgPoolCtor) {
        console.warn("[WELCOME] Module pg absent, config panel DB desactivee.");
      }
      if (!RedisCtor) {
        console.warn("[WELCOME] Module ioredis absent, refresh Redis desactive.");
      }
    });

    client.on("guildMemberAdd", async (member) => {
      try {
        if (client.config?.guildId && member.guild.id !== client.config.guildId) {
          return;
        }

        const config = getGuildConfig(member.guild.id);
        if (!config.enabled) {
          return;
        }

        const welcomeChannel = await fetchGuildTextChannel(member.guild, config.channelId);
        if (!welcomeChannel) {
          console.error(
            `[WELCOME] Salon introuvable/invalide (${config.channelId}) sur ${member.guild.name}`
          );
          return;
        }

        const botMember = member.guild.members.me || (await member.guild.members.fetchMe().catch(() => null));
        if (!botMember) {
          console.error(`[WELCOME] Impossible de recuperer le membre bot sur ${member.guild.name}`);
          return;
        }

        const perms = canSendWelcome(botMember, welcomeChannel);
        if (!perms.canView || !perms.canSend || !perms.canEmbed) {
          console.error(
            `[WELCOME] Permissions manquantes dans #${welcomeChannel.name}: ViewChannel/SendMessages/EmbedLinks`
          );
          return;
        }

        const titleUrl = await resolveTitleUrl(member.guild, config.titleTargetChannelId);
        const embed = buildWelcomeEmbed({
          member,
          titleUrl,
          botAvatarUrl: client.user?.displayAvatarURL(),
        });

        const files = [];
        const thumbnailPath = path.join(__dirname, WELCOME_THUMBNAIL_FILE);
        if (perms.canAttach && fs.existsSync(thumbnailPath)) {
          files.push(new AttachmentBuilder(thumbnailPath, { name: WELCOME_THUMBNAIL_FILE }));
          embed.setThumbnail(`attachment://${WELCOME_THUMBNAIL_FILE}`);
        }

        await welcomeChannel.send({
          embeds: [embed],
          files,
          allowedMentions: { users: [member.id] },
        });

        console.log(`[WELCOME] Message envoye pour ${member.user.tag} dans #${welcomeChannel.name}`);
      } catch (error) {
        console.error(`[WELCOME] Echec pour ${member.user?.tag || member.id} (${member.id})`);
        console.error(error);
      }
    });
  },
};
