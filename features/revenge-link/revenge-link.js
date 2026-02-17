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
const TITLE_1 = "🗃️・__**REVENGE 🎯**__";
const TITLE_2 = "🗃️・__**REVENGE｜SkySword**__";

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

function buildLinkEmbed({ title, inviteUrl, thumbnailAttachmentName, color }) {
  const embed = new EmbedBuilder()
    .setColor(color ?? 0xe11d48)
    .setDescription(`${title}\n\n➡️ ・ [Clique ici pour rejoindre le serveur](${inviteUrl})`);

  if (thumbnailAttachmentName) {
    embed.setThumbnail(`attachment://${thumbnailAttachmentName}`);
  }

  return embed;
}

function buildLinkPayload({ title, inviteUrl, thumbnailPath, color }) {
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
        color,
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

async function fetchMessageById(channel, messageId) {
  if (!messageId) {
    return null;
  }
  return channel.messages.fetch(messageId).catch(() => null);
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

  const thumbnail1Path = findFirstExistingFile(THUMBNAIL_1_CANDIDATES);
  const thumbnail2Path = findFirstExistingFile(THUMBNAIL_2_CANDIDATES);
  const gifPath = fs.existsSync(MIDDLE_GIF_PATH) ? MIDDLE_GIF_PATH : null;
  const gifPayload = buildGifPayload(gifPath);
  const payloads = [
    buildLinkPayload({
      title: TITLE_1,
      inviteUrl: INVITE_URL_1,
      thumbnailPath: thumbnail1Path,
      color: 0xe11d48,
    }),
  ];

  if (gifPayload) {
    payloads.push(gifPayload);
  }

  payloads.push(
    buildLinkPayload({
      title: TITLE_2,
      inviteUrl: INVITE_URL_2,
      thumbnailPath: thumbnail2Path,
      color: 0x22c55e,
    })
  );

  const state = readJsonFile(STATE_FILE, null);
  if (
    state &&
    state.guildId === channel.guild.id &&
    state.channelId === channel.id &&
    Array.isArray(state.messageIds) &&
    state.messageIds.length === payloads.length
  ) {
    const messages = [];
    for (const messageId of state.messageIds) {
      const message = await fetchMessageById(channel, messageId);
      if (!message || message.author?.id !== client.user.id) {
        messages.length = 0;
        break;
      }
      messages.push(message);
    }

    if (messages.length === payloads.length) {
      for (let i = 0; i < messages.length; i += 1) {
        await messages[i].edit(payloads[i]).catch(() => null);
      }
      return;
    }
  }

  const sentMessages = [];
  for (const payload of payloads) {
    const sent = await channel.send(payload);
    sentMessages.push(sent);
  }

  const messageIds = sentMessages.map((message) => message.id);
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
