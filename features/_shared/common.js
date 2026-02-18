const fs = require("node:fs");
const path = require("node:path");
const { MessageFlags, PermissionFlagsBits } = require("discord.js");

const PLACEHOLDER_GUILD_ID = "PASTE_YOUR_GUILD_ID_HERE";

function hasConfiguredGuildId(client) {
  const guildId = client?.config?.guildId;
  return Boolean(guildId && guildId !== PLACEHOLDER_GUILD_ID);
}

async function fetchConfiguredGuild(client) {
  if (!hasConfiguredGuildId(client)) {
    return null;
  }

  return client.guilds.fetch(client.config.guildId).catch(() => null);
}

async function fetchGuildTextChannel(guild, channelId) {
  if (!guild || !channelId) {
    return null;
  }

  const channel =
    guild.channels.cache.get(channelId) ||
    (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || !channel.isTextBased?.()) {
    return null;
  }

  return channel;
}

async function fetchGuildRole(guild, roleId) {
  if (!guild || !roleId) {
    return null;
  }

  return (
    guild.roles.cache.get(roleId) ||
    (await guild.roles.fetch(roleId).catch(() => null))
  );
}

async function fetchBotMember(guild) {
  if (!guild) {
    return null;
  }

  return guild.members.me || (await guild.members.fetchMe().catch(() => null));
}

async function resolveManageableRole(guild, roleId) {
  const role = await fetchGuildRole(guild, roleId);
  if (!role) {
    return { ok: false, code: "ROLE_NOT_FOUND", role: null, botMember: null };
  }

  const botMember = await fetchBotMember(guild);
  if (!botMember) {
    return { ok: false, code: "BOT_MEMBER_NOT_FOUND", role, botMember: null };
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, code: "MISSING_MANAGE_ROLES", role, botMember };
  }

  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    return { ok: false, code: "ROLE_ABOVE_BOT", role, botMember };
  }

  return { ok: true, code: null, role, botMember };
}

async function replyEphemeral(interaction, content, extra = {}) {
  return interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    ...extra,
  });
}

async function findBotMessageByComponent(channel, botId, {
  exactId,
  startsWith,
  limit = 75,
}) {
  if (!channel || !botId || (!exactId && !startsWith)) {
    return null;
  }

  const messages = await channel.messages.fetch({ limit }).catch(() => null);
  if (!messages) {
    return null;
  }

  return (
    messages.find((message) => {
      if (message.author?.id !== botId) {
        return false;
      }

      return message.components.some((row) =>
        row.components.some((component) => {
          if (typeof component.customId !== "string") {
            return false;
          }
          if (exactId) {
            return component.customId === exactId;
          }
          return component.customId.startsWith(startsWith);
        })
      );
    }) || null
  );
}

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function upsertGuildCommand({
  client,
  commandName,
  commandJson,
  logPrefix,
  missingGuildLog,
}) {
  const guild = await fetchConfiguredGuild(client);
  if (!guild) {
    if (missingGuildLog) {
      console.warn(`[${logPrefix}] ${missingGuildLog}`);
    }
    return false;
  }

  try {
    const commands = await guild.commands.fetch();
    const existing = commands.find((command) => command.name === commandName);

    if (existing) {
      await guild.commands.edit(existing.id, commandJson);
      console.log(`[${logPrefix}] Commande /${commandName} mise à jour`);
    } else {
      await guild.commands.create(commandJson);
      console.log(`[${logPrefix}] Commande /${commandName} créée`);
    }

    return true;
  } catch (error) {
    console.error(`[${logPrefix}] Échec d'enregistrement de /${commandName}`);
    console.error(error);
    return false;
  }
}

async function deleteGuildCommand({
  client,
  commandName,
  logPrefix,
  failLog,
}) {
  const guild = await fetchConfiguredGuild(client);
  if (!guild) {
    return false;
  }

  try {
    const commands = await guild.commands.fetch();
    const existing = commands.find((command) => command.name === commandName);

    if (!existing) {
      return false;
    }

    await guild.commands.delete(existing.id);
    console.log(`[${logPrefix}] Ancienne commande /${commandName} supprimée`);
    return true;
  } catch (error) {
    console.error(`[${logPrefix}] ${failLog || `Échec de suppression de /${commandName}`}`);
    console.error(error);
    return false;
  }
}

async function fetchTextMessage(client, channelId, messageId) {
  if (!channelId || !messageId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) {
    return null;
  }

  return channel.messages.fetch(messageId).catch(() => null);
}

module.exports = {
  deleteGuildCommand,
  fetchBotMember,
  fetchConfiguredGuild,
  fetchGuildRole,
  fetchGuildTextChannel,
  fetchTextMessage,
  findBotMessageByComponent,
  hasConfiguredGuildId,
  readJsonFile,
  replyEphemeral,
  resolveManageableRole,
  upsertGuildCommand,
  writeJsonFile,
};
