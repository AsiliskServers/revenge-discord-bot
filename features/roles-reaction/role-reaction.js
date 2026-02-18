const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
const {
  fetchConfiguredGuild,
  fetchGuildTextChannel,
  findBotMessageByComponent,
  hasConfiguredGuildId,
  readJsonFile,
  replyEphemeral,
  resolveManageableRole,
  writeJsonFile,
} = require("../_shared/common");

const TARGET_CHANNEL_ID = "1470813116395946229";
const BUTTON_PREFIX = "role_reaction:";

const ROLE_OPTIONS = [
  { key: "giveaways", label: "🎁┃Giveaways", roleId: "1379156738346848297" },
  { key: "annonces", label: "📢┃Annonces", roleId: "1472050708474761502" },
  { key: "sondages", label: "📊┃Sondages", roleId: "1472050709158432862" },
  { key: "events", label: "🎉┃Événements", roleId: "1472050710186033254" },
];

const ROLE_BY_KEY = new Map(ROLE_OPTIONS.map((item) => [item.key, item]));

const RUNTIME_DIR = path.join(__dirname, ".runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "role-reaction-message.json");

function buildEmbed() {
  return new EmbedBuilder()
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
}

function buildComponents() {
  const buttons = ROLE_OPTIONS.map((item) =>
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${item.key}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(item.label)
  );

  return [new ActionRowBuilder().addComponents(buttons)];
}

function buildPayload() {
  return {
    embeds: [buildEmbed()],
    components: buildComponents(),
    allowedMentions: { parse: [] },
  };
}

async function findExistingMessage(channel, botId) {
  return findBotMessageByComponent(channel, botId, {
    startsWith: BUTTON_PREFIX,
    limit: 100,
  });
}

async function ensureRoleReactionMessage(client) {
  const guild = await fetchConfiguredGuild(client);
  if (!guild) {
    return;
  }

  const channel = await fetchGuildTextChannel(guild, TARGET_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(`[ROLE REACTION] Salon invalide ou introuvable (${TARGET_CHANNEL_ID}).`);
    return;
  }

  const payload = buildPayload();
  const state = readJsonFile(STATE_FILE, null);

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

  const existing = await findExistingMessage(channel, client.user.id);
  if (existing) {
    await existing.edit(payload).catch(() => null);
    writeJsonFile(STATE_FILE, {
      guildId: guild.id,
      channelId: channel.id,
      messageId: existing.id,
    });
    return;
  }

  const sent = await channel.send(payload);
  writeJsonFile(STATE_FILE, {
    guildId: guild.id,
    channelId: channel.id,
    messageId: sent.id,
  });
}

async function handleRoleButton(interaction) {
  const key = interaction.customId.slice(BUTTON_PREFIX.length);
  const roleOption = ROLE_BY_KEY.get(key);
  if (!roleOption) {
    return;
  }

  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, "Cette action est disponible uniquement sur le serveur.");
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

module.exports = {
  name: "feature:role-reaction",
  async init(client) {
    client.once("clientReady", async () => {
      if (!hasConfiguredGuildId(client)) {
        console.warn("[ROLE REACTION] DISCORD_GUILD_ID absent, feature ignorée.");
        return;
      }
      await ensureRoleReactionMessage(client);
    });

    client.on("interactionCreate", async (interaction) => {
      if (interaction.isButton() && interaction.customId.startsWith(BUTTON_PREFIX)) {
        await handleRoleButton(interaction);
      }
    });
  },
};
