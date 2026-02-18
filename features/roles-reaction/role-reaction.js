const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
const {
  fetchGuildTextChannel,
  fetchTextMessage,
  findBotMessageByComponent,
  hasConfiguredGuildId,
  readJsonFile,
  replyEphemeral,
  resolveManageableRole,
  writeJsonFile,
} = require("../_shared/common");

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

const FEATURE_KEY = "roles-reaction";
const BUTTON_PREFIX = "role_reaction:";
const REDIS_CHANNEL = process.env.PANEL_REDIS_CHANNEL || "revenge:feature:update";

const DEFAULT_CONFIG = {
  enabled: true,
  channelId: "1470813116395946229",
  roles: [
    { key: "giveaways", label: "🎁┃Giveaways", roleId: "1379156738346848297" },
    { key: "annonces", label: "📢┃Annonces", roleId: "1472050708474761502" },
    { key: "sondages", label: "📊┃Sondages", roleId: "1472050709158432862" },
    { key: "events", label: "🎉┃Événements", roleId: "1472050710186033254" },
  ],
};

const RUNTIME_DIR = path.join(__dirname, ".runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "role-reaction-message.json");

const runtime = {
  dbPool: null,
  schemaReady: false,
  redisSubscriber: null,
  pollTimer: null,
  configByGuild: new Map(),
};

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeRoles(inputRoles) {
  const source = Array.isArray(inputRoles) ? inputRoles : DEFAULT_CONFIG.roles;
  const entries = source
    .slice(0, 10)
    .map((entry, index) => {
      const key =
        asString(entry?.key)
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "") || `role_${index + 1}`;

      return {
        key,
        label: asString(entry?.label, `Rôle ${index + 1}`),
        roleId: asString(entry?.roleId),
      };
    })
    .filter((entry) => entry.label.length > 0 && entry.roleId.length > 0);

  return entries.length > 0 ? entries : DEFAULT_CONFIG.roles;
}

function normalizeConfig(rawEnabled, rawConfig) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    enabled: typeof rawEnabled === "boolean" ? rawEnabled : true,
    channelId: asString(source.channelId, DEFAULT_CONFIG.channelId),
    roles: normalizeRoles(source.roles),
  };
}

function configRoleByCustomId(config) {
  return new Map(
    (config.roles || []).map((role) => [`${BUTTON_PREFIX}${role.key}`, role])
  );
}

function buildEmbed(config) {
  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("__**❓**__ㆍ__**À QUOI ÇA SERT ?**__")
    .setDescription(
      "Ce système est un moyen automatisé vous permettant d'obtenir des rôles en réagissant à un message.\n\n" +
        "**🎭 Salons spécifiques**\n" +
        "> *Certains rôles vous donnent accès à des parties cachées du serveur.*\n\n" +
        "**⚙️ Personnalisation**\n" +
        "> *Les utilisateurs peuvent choisir des rôles liés à leurs centres d’intérêt, mini-jeux, notifications, etc.*\n\n" +
        "**👍 Gestion simplifiée**\n" +
        "> *Évite aux administrateurs de devoir attribuer manuellement les rôles à chaque membre.*"
    );

  if (!config.enabled) {
    embed.setFooter({
      text: "Fonctionnalité temporairement désactivée. Contactez un administrateur.",
    });
  }

  return embed;
}

function buildComponents(config) {
  const disableButtons = !config.enabled;
  const buttons = (config.roles || []).map((item) =>
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${item.key}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(item.label)
      .setDisabled(disableButtons)
  );

  return chunk(buttons, 5).map((rowButtons) =>
    new ActionRowBuilder().addComponents(rowButtons)
  );
}

function buildPayload(config) {
  return {
    embeds: [buildEmbed(config)],
    components: buildComponents(config),
    allowedMentions: { parse: [] },
  };
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
    console.error("[ROLE REACTION] PostgreSQL pool error");
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
      [guildId, FEATURE_KEY]
    );

    const row = result.rows?.[0];
    if (!row) {
      return DEFAULT_CONFIG;
    }

    return normalizeConfig(row.enabled, row.config_json);
  } catch (error) {
    console.error("[ROLE REACTION] Impossible de charger la config DB, fallback default.");
    console.error(error);
    return DEFAULT_CONFIG;
  }
}

function readMessageState() {
  const state = readJsonFile(STATE_FILE, null);
  if (!state || typeof state !== "object") {
    return null;
  }
  return state?.channelId && state?.messageId ? state : null;
}

function writeMessageState(state) {
  writeJsonFile(STATE_FILE, state || {});
}

async function deleteTrackedMessage(client, state) {
  if (!state?.channelId || !state?.messageId) {
    return;
  }
  const message = await fetchTextMessage(client, state.channelId, state.messageId);
  if (message) {
    await message.delete().catch(() => null);
  }
}

async function findExistingMessage(channel, botId) {
  return findBotMessageByComponent(channel, botId, {
    startsWith: BUTTON_PREFIX,
    limit: 100,
  });
}

async function ensureRoleReactionMessage(client, guild, config) {
  const channel = await fetchGuildTextChannel(guild, config.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(
      `[ROLE REACTION] Salon invalide ou introuvable (${config.channelId}).`
    );
    return;
  }

  const payload = buildPayload(config);
  const state = readMessageState();

  if (
    state &&
    state.guildId === guild.id &&
    state.channelId === channel.id &&
    state.messageId
  ) {
    const message = await channel.messages.fetch(state.messageId).catch(() => null);
    if (message) {
      await message.edit(payload).catch(() => null);
      return;
    }
  }

  if (
    state &&
    state.guildId === guild.id &&
    state.channelId &&
    state.channelId !== channel.id &&
    state.messageId
  ) {
    await deleteTrackedMessage(client, state).catch(() => null);
  }

  const existing = await findExistingMessage(channel, client.user.id);
  if (existing) {
    await existing.edit(payload).catch(() => null);
    writeMessageState({
      guildId: guild.id,
      channelId: channel.id,
      messageId: existing.id,
    });
    return;
  }

  const sent = await channel.send(payload);
  writeMessageState({
    guildId: guild.id,
    channelId: channel.id,
    messageId: sent.id,
  });
}

async function refreshGuildConfigAndMessage(client, guildId) {
  if (!guildId) {
    return;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return;
  }

  const config = await loadConfigForGuild(guildId);
  runtime.configByGuild.set(guildId, config);
  await ensureRoleReactionMessage(client, guild, config);
}

async function resolveGuildConfig(guildId) {
  const config = canUseDatabase()
    ? await loadConfigForGuild(guildId)
    : runtime.configByGuild.get(guildId) || (await loadConfigForGuild(guildId));
  runtime.configByGuild.set(guildId, config);
  return config;
}

async function handleRoleButton(interaction) {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, "Cette action est disponible uniquement sur le serveur.");
    return;
  }

  const config = await resolveGuildConfig(interaction.guildId);

  if (!config.enabled) {
    await replyEphemeral(
      interaction,
      "La fonctionnalité Roles Reaction est actuellement désactivée. Merci de contacter un administrateur."
    );
    return;
  }

  const roleOption = configRoleByCustomId(config).get(interaction.customId);
  if (!roleOption) {
    await replyEphemeral(interaction, "Ce bouton n'est plus actif.");
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await replyEphemeral(interaction, "Impossible de récupérer ton profil serveur.");
    return;
  }

  const resolvedRole = await resolveManageableRole(interaction.guild, roleOption.roleId);
  if (!resolvedRole.ok) {
    const content =
      resolvedRole.code === "ROLE_NOT_FOUND"
        ? "Rôle introuvable. Contacte un administrateur."
        : resolvedRole.code === "BOT_MEMBER_NOT_FOUND"
          ? "Membre bot introuvable."
          : resolvedRole.code === "MISSING_MANAGE_ROLES"
            ? "Permission bot manquante : ManageRoles."
            : "Le rôle du bot doit être au-dessus du rôle ciblé.";
    await replyEphemeral(interaction, content);
    return;
  }

  if (member.roles.cache.has(resolvedRole.role.id)) {
    await member.roles.remove(resolvedRole.role, "Rôle réaction retiré par bouton");
    await replyEphemeral(interaction, `Rôle retiré : ${resolvedRole.role.name}`);
    return;
  }

  await member.roles.add(resolvedRole.role, "Rôle réaction ajouté par bouton");
  await replyEphemeral(interaction, `Rôle ajouté : ${resolvedRole.role.name}`);
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
    console.error("[ROLE REACTION] Redis subscriber error");
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
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
          return;
        }
        const config = normalizeConfig(payload.enabled, payload.config);
        runtime.configByGuild.set(guildId, config);
        console.info(
          `[ROLE REACTION] Update Redis applique: enabled=${config.enabled} guild=${guildId}`
        );
        await ensureRoleReactionMessage(client, guild, config);
        return;
      }

      await refreshGuildConfigAndMessage(client, guildId);
    } catch (error) {
      console.error("[ROLE REACTION] Redis payload invalide");
      console.error(error);
    }
  });

  subscriber.subscribe(REDIS_CHANNEL).catch((error) => {
    console.error("[ROLE REACTION] Impossible de s'abonner au channel Redis");
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
    void refreshGuildConfigAndMessage(client, client.config.guildId);
  }, 45_000);

  if (typeof runtime.pollTimer.unref === "function") {
    runtime.pollTimer.unref();
  }
}

module.exports = {
  name: "feature:role-reaction",
  async init(client) {
    client.once("clientReady", async () => {
      if (!hasConfiguredGuildId(client)) {
        console.warn("[ROLE REACTION] DISCORD_GUILD_ID absent, feature ignorée.");
        return;
      }

      const hasDbUrl = Boolean(getDatabaseUrl());
      const hasRedisUrl = Boolean(asString(process.env.PANEL_REDIS_URL));
      console.info(
        `[ROLE REACTION] Boot config: db_url=${hasDbUrl ? "yes" : "no"} redis_url=${
          hasRedisUrl ? "yes" : "no"
        }`
      );

      await refreshGuildConfigAndMessage(client, client.config.guildId);
      startRedisSubscription(client);
      startDatabasePolling(client);

      if (!hasDbUrl) {
        console.warn(
          "[ROLE REACTION] PANEL_DATABASE_URL absent: lecture DB des settings desactivee."
        );
      }
      if (!hasRedisUrl) {
        console.warn(
          "[ROLE REACTION] PANEL_REDIS_URL absent: refresh temps reel depuis panel desactive."
        );
      }

      if (!PgPoolCtor) {
        console.warn(
          "[ROLE REACTION] Module pg absent, fonctionnement en config locale par défaut."
        );
      }
      if (!RedisCtor) {
        console.warn(
          "[ROLE REACTION] Module ioredis absent, refresh à chaud Redis désactivé."
        );
      }
    });

    client.on("interactionCreate", async (interaction) => {
      if (interaction.isButton() && interaction.customId.startsWith(BUTTON_PREFIX)) {
        await handleRoleButton(interaction);
      }
    });
  },
};
