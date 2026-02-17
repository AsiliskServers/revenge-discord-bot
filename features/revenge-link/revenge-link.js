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

const RUNTIME_DIR = path.join(__dirname, ".runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "revenge-link-message.json");

const IMAGE_1_CANDIDATES = [
  path.join(__dirname, "image-1.png"),
  path.join(__dirname, "image1.png"),
  path.join(__dirname, "image.png"),
];

const IMAGE_2_CANDIDATES = [
  path.join(__dirname, "image-2.png"),
  path.join(__dirname, "image2.png"),
  path.join(__dirname, "image-second.png"),
];

function findFirstExistingFile(candidates) {
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function buildLinkEmbed({ title, inviteUrl, imageAttachmentName }) {
  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle(title)
    .setURL(inviteUrl)
    .setDescription(`:discord_annonce:・[Clique ici pour rejoindre le serveur](${inviteUrl})`);

  if (imageAttachmentName) {
    embed.setImage(`attachment://${imageAttachmentName}`);
  }

  return embed;
}

function buildPayload() {
  const files = [];

  const image1Path = findFirstExistingFile(IMAGE_1_CANDIDATES);
  const image2Path = findFirstExistingFile(IMAGE_2_CANDIDATES);

  let image1Name = null;
  let image2Name = null;

  if (image1Path) {
    image1Name = path.basename(image1Path);
    files.push(new AttachmentBuilder(image1Path, { name: image1Name }));
  }

  if (image2Path) {
    image2Name = path.basename(image2Path);
    files.push(new AttachmentBuilder(image2Path, { name: image2Name }));
  }

  return {
    content: null,
    embeds: [
      buildLinkEmbed({
        title: ":discord_logo:・REVENGE 🎯",
        inviteUrl: INVITE_URL_1,
        imageAttachmentName: image1Name,
      }),
      buildLinkEmbed({
        title: ":discord_logo:・REVENGE｜SkySword",
        inviteUrl: INVITE_URL_2,
        imageAttachmentName: image2Name,
      }),
    ],
    files,
    allowedMentions: { parse: [] },
  };
}

async function findExistingMessage(channel, botId) {
  const messages = await channel.messages.fetch({ limit: 75 }).catch(() => null);
  if (!messages) {
    return null;
  }

  return (
    messages.find((message) => {
      if (message.author?.id !== botId) {
        return false;
      }

      const titles = message.embeds.map((embed) => embed.title || "");
      return (
        titles.includes(":discord_logo:・REVENGE 🎯") &&
        titles.includes(":discord_logo:・REVENGE｜SkySword")
      );
    }) || null
  );
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

  const payload = buildPayload();
  const state = readJsonFile(STATE_FILE, null);

  if (
    state &&
    state.guildId === channel.guild.id &&
    state.channelId === channel.id &&
    state.messageId
  ) {
    const message = await channel.messages.fetch(state.messageId).catch(() => null);
    if (message) {
      await message.edit(payload).catch(() => null);
      return;
    }
  }

  const existing = await findExistingMessage(channel, client.user.id);
  if (existing) {
    await existing.edit(payload).catch(() => null);
    writeJsonFile(STATE_FILE, {
      guildId: channel.guild.id,
      channelId: channel.id,
      messageId: existing.id,
    });
    return;
  }

  const sent = await channel.send(payload);
  writeJsonFile(STATE_FILE, {
    guildId: channel.guild.id,
    channelId: channel.id,
    messageId: sent.id,
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
