const fs = require("node:fs");
const path = require("node:path");
const {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
const {
  fetchConfiguredGuild,
  fetchGuildTextChannel,
  hasConfiguredGuildId,
  readJsonFile,
  writeJsonFile,
} = require("../_shared/common");

const TARGET_CHANNEL_ID = "1349631503730212965";
const INVITE_URL_1 = "https://discord.gg/mv9jUbTWxh";
const INVITE_URL_2 = "https://discord.gg/tcNhANtj28";
const TITLE_1 = "🗃️・REVENGE";
const TITLE_2 = "🗃️・REVENGE｜SkySword";

const RUNTIME_DIR = path.join(__dirname, ".runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "revenge-link-message.json");

const THUMBNAIL_1_CANDIDATES = [
  path.join(__dirname, "Rrouge.png"),
  path.join(__dirname, "rrouge.png"),
];

const THUMBNAIL_2_CANDIDATES = [
  path.join(__dirname, "Rvert.png"),
  path.join(__dirname, "rvert.png"),
];

const MIDDLE_GIF_PATH = path.join(__dirname, "image.gif");

function findFirstExistingFile(candidates) {
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function buildLinkEmbed({ title, inviteUrl, thumbnailAttachmentName }) {
  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle(title)
    .setDescription(`\n\n➡️ ・ [Clique ici pour rejoindre le serveur](${inviteUrl})\n`);

  if (thumbnailAttachmentName) {
    embed.setThumbnail(`attachment://${thumbnailAttachmentName}`);
  }

  return embed;
}

function buildLinkPayload({ title, inviteUrl, thumbnailPath }) {
  const files = [];
  let thumbnailAttachmentName = null;

  if (thumbnailPath) {
    thumbnailAttachmentName = path.basename(thumbnailPath);
    files.push(new AttachmentBuilder(thumbnailPath, { name: thumbnailAttachmentName }));
  }

  return {
    content: null,
    embeds: [
      buildLinkEmbed({
        title,
        inviteUrl,
        thumbnailAttachmentName,
      }),
    ],
    files,
    allowedMentions: { parse: [] },
  };
}

function buildGifPayload(gifPath) {
  if (!gifPath) {
    return null;
  }

  return {
    content: null,
    files: [new AttachmentBuilder(gifPath, { name: path.basename(gifPath) })],
    allowedMentions: { parse: [] },
  };
}

async function deleteMessageIfExists(channel, messageId) {
  if (!messageId) {
    return;
  }

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    return;
  }

  await message.delete().catch(() => null);
}

async function cleanupPreviousMessages(channel, botId) {
  const state = readJsonFile(STATE_FILE, null);

  if (state?.messageId) {
    await deleteMessageIfExists(channel, state.messageId);
  }

  if (Array.isArray(state?.messageIds)) {
    for (const messageId of state.messageIds) {
      await deleteMessageIfExists(channel, messageId);
    }
  }

  const messages = await channel.messages.fetch({ limit: 75 }).catch(() => null);
  if (!messages) {
    return;
  }

  const legacyCombined = messages.find((message) => {
    if (message.author?.id !== botId) {
      return false;
    }

      const titles = message.embeds.map((embed) => embed.title || "");
      return (
        titles.includes(TITLE_1) &&
        titles.includes(TITLE_2)
      );
    });

  if (legacyCombined) {
    await legacyCombined.delete().catch(() => null);
  }
}

async function ensureRevengeLinkMessage(client) {
  const guild = await fetchConfiguredGuild(client);
  if (!guild) {
    return;
  }

  const channel = await fetchGuildTextChannel(guild, TARGET_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(`[REVENGE LINK] Salon invalide ou introuvable (${TARGET_CHANNEL_ID}).`);
    return;
  }

  await cleanupPreviousMessages(channel, client.user.id);

  const thumbnail1Path = findFirstExistingFile(THUMBNAIL_1_CANDIDATES);
  const thumbnail2Path = findFirstExistingFile(THUMBNAIL_2_CANDIDATES);
  const gifPath = fs.existsSync(MIDDLE_GIF_PATH) ? MIDDLE_GIF_PATH : null;

  const firstMessage = await channel.send(
    buildLinkPayload({
      title: TITLE_1,
      inviteUrl: INVITE_URL_1,
      thumbnailPath: thumbnail1Path,
    })
  );

  let gifMessage = null;
  const gifPayload = buildGifPayload(gifPath);
  if (gifPayload) {
    gifMessage = await channel.send(gifPayload);
  }

  const secondMessage = await channel.send(
    buildLinkPayload({
      title: TITLE_2,
      inviteUrl: INVITE_URL_2,
      thumbnailPath: thumbnail2Path,
    })
  );

  const messageIds = [firstMessage.id, gifMessage?.id, secondMessage.id].filter(Boolean);
  writeJsonFile(STATE_FILE, {
    guildId: channel.guild.id,
    channelId: channel.id,
    messageIds,
    version: 2,
  });
}

module.exports = {
  name: "feature:revenge-link",
  async init(client) {
    client.once("clientReady", async () => {
      if (!hasConfiguredGuildId(client)) {
        console.warn("[REVENGE LINK] DISCORD_GUILD_ID absent, feature ignoree.");
        return;
      }

      await ensureRevengeLinkMessage(client);
    });
  },
};
