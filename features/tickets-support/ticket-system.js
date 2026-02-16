const fs = require("node:fs");
const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require("discord.js");
const {
  fetchConfiguredGuild,
  fetchGuildTextChannel,
  fetchTextMessage,
  hasConfiguredGuildId,
  readJsonFile,
  writeJsonFile,
} = require("../_shared/common");

const SUPPORT_CHANNEL_ID = "996446504199917668";
const SUPPORT_TICKET_CATEGORY_ID = "1383247332908335207";

const OPEN_TICKET_SELECT_ID = "ticket_open_select";
const TICKET_BUTTON_CLAIM_ID = "ticket_claim";
const TICKET_BUTTON_CLOSE_ID = "ticket_close";
const TICKET_BUTTON_DELETE_ID = "ticket_delete";

const RUNTIME_DIR = path.join(__dirname, ".runtime");
const HUB_STATE_FILE = path.join(RUNTIME_DIR, "ticket-hub-message.json");
const TICKETS_STATE_FILE = path.join(RUNTIME_DIR, "tickets-state.json");
const TICKETS_META_FILE = path.join(RUNTIME_DIR, "tickets-meta.json");

const HUB_IMAGE_FILES = [
  path.join(__dirname, "image.png"),
  path.join(__dirname, "ticket-image.png"),
  path.join(__dirname, "banner.png"),
  path.join(__dirname, "..", "message-bienvenue", "image.png"),
];

const TICKET_REASONS = [
  {
    value: "partenariat",
    label: "Demande de partenariat",
    emoji: "🚩",
    description: "Proposer un partenariat avec Revenge",
  },
  {
    value: "signalement-membre",
    label: "Signaler un membre",
    emoji: "📤",
    description: "Signaler un comportement inapproprie",
  },
  {
    value: "contestation-sanction",
    label: "Contestation d'une sanction",
    emoji: "💢",
    description: "Contester un mute, kick ou ban",
  },
  {
    value: "bug",
    label: "Signaler un bug",
    emoji: "❗",
    description: "Remonter un bug rencontre sur le serveur",
  },
  {
    value: "autres",
    label: "Autres",
    emoji: "❓",
    description: "Toute autre demande",
  },
];

const reasonByValue = new Map(TICKET_REASONS.map((reason) => [reason.value, reason]));
const ticketStore = new Map();
const ticketMeta = {
  totalCreated: 0,
};
let missingImageWarned = false;
let selectedImageWarned = false;

function resolveHubImageFile() {
  for (const candidate of HUB_IMAGE_FILES) {
    if (fs.existsSync(candidate)) {
      if (!selectedImageWarned) {
        selectedImageWarned = true;
        console.log(`[TICKET] Image panel utilisee: ${candidate}`);
      }
      return candidate;
    }
  }
  return null;
}

function toTicketRecord(raw) {
  if (!raw || !raw.channelId || !raw.guildId || !raw.ownerId) {
    return null;
  }

  return {
    channelId: String(raw.channelId),
    guildId: String(raw.guildId),
    ownerId: String(raw.ownerId),
    ticketNumber: Number(raw.ticketNumber || 0),
    reasonValue: String(raw.reasonValue || "autres"),
    reasonLabel: String(raw.reasonLabel || "Autres"),
    claimedById: raw.claimedById ? String(raw.claimedById) : null,
    status: raw.status === "closed" ? "closed" : "open",
    panelMessageId: raw.panelMessageId ? String(raw.panelMessageId) : null,
    createdAt: Number(raw.createdAt || Date.now()),
  };
}

function loadTicketStore() {
  ticketStore.clear();
  let maxTicketNumber = 0;
  const raw = readJsonFile(TICKETS_STATE_FILE, []);
  for (const item of raw) {
    const ticket = toTicketRecord(item);
    if (ticket) {
      ticketStore.set(ticket.channelId, ticket);
      maxTicketNumber = Math.max(maxTicketNumber, ticket.ticketNumber || 0);
    }
  }
  return maxTicketNumber;
}

function saveTicketStore() {
  writeJsonFile(TICKETS_STATE_FILE, Array.from(ticketStore.values()));
}

function loadTicketMeta(maxTicketNumberFromStore) {
  const raw = readJsonFile(TICKETS_META_FILE, { totalCreated: 0 });
  const parsed = Number(raw?.totalCreated || 0);
  ticketMeta.totalCreated = Math.max(
    Number.isFinite(parsed) ? parsed : 0,
    Number(maxTicketNumberFromStore || 0)
  );
}

function saveTicketMeta() {
  writeJsonFile(TICKETS_META_FILE, ticketMeta);
}

function nextTicketNumber() {
  ticketMeta.totalCreated += 1;
  saveTicketMeta();
  return ticketMeta.totalCreated;
}

async function getSupportChannel(client) {
  const guild = await fetchConfiguredGuild(client);
  if (!guild) {
    return null;
  }

  const channel = await fetchGuildTextChannel(guild, SUPPORT_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return null;
  }

  return channel;
}

function buildHubPayload() {
  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("🆘 Demande de support")
    .setDescription(
      "Contactez notre support grâce à un ticket, il sera pris en charge aussi vite que possible! ⏰\n\n" +
        "Afin de créer un ticket et obtenir de l'aide, sélectionnez la raison de votre ticket à l'aide du menu déroulant ci-dessous. 📍"
    );

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(OPEN_TICKET_SELECT_ID)
          .setPlaceholder("📩 | Veuillez sélectionner la raison de votre ticket")
          .addOptions(
            TICKET_REASONS.map((reason) => ({
              label: reason.label,
              value: reason.value,
              emoji: reason.emoji,
              description: reason.description,
            }))
          )
      ),
    ],
    allowedMentions: { parse: [] },
  };

  const imagePath = resolveHubImageFile();
  if (imagePath) {
    const attachmentName = path.basename(imagePath);
    embed.setImage(`attachment://${attachmentName}`);
    payload.files = [
      {
        attachment: imagePath,
        name: attachmentName,
      },
    ];
  } else if (!missingImageWarned) {
    missingImageWarned = true;
    console.warn(
      `[TICKET] Image introuvable. Ajoute un fichier image dans: ${path.join(__dirname, "image.png")}`
    );
  }

  return payload;
}

function buildTicketEmbed(ticket) {
  const statusLabel = ticket.status === "closed" ? "Fermé" : "Ouvert";
  const claimedByLabel = ticket.claimedById ? `<@${ticket.claimedById}>` : "Personne";

  return new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("🎫 Ticket Support")
    .setDescription(
      "Ton ticket a été créé. 🔔\n" +
        "Fournis nous toute information supplémentaire que tu juges utile qui pourrait nous aider à résoudre et répondre le plus rapidement."
    )
    .addFields(
      {
        name: "Créé par",
        value: `<@${ticket.ownerId}>`,
        inline: true,
      },
      {
        name: "Raison",
        value: ticket.reasonLabel,
        inline: true,
      },
      {
        name: "Statut",
        value: statusLabel,
        inline: true,
      },
      {
        name: "Claim",
        value: claimedByLabel,
        inline: false,
      }
    )
    .setFooter({ text: `Ticket ${ticket.channelId}` });
}

function buildTicketButtons(ticket) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_BUTTON_CLAIM_ID)
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🎟️")
      .setLabel("Claim")
      .setDisabled(Boolean(ticket.claimedById)),
    new ButtonBuilder()
      .setCustomId(TICKET_BUTTON_CLOSE_ID)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔒")
      .setLabel("Close")
      .setDisabled(ticket.status === "closed"),
    new ButtonBuilder()
      .setCustomId(TICKET_BUTTON_DELETE_ID)
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🗑️")
      .setLabel("Delete")
  );
}

function buildTicketPanelPayload(ticket) {
  return {
    embeds: [buildTicketEmbed(ticket)],
    components: [buildTicketButtons(ticket)],
    allowedMentions: { parse: [] },
  };
}

function isTicketStaff(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
  );
}

function sanitizeName(value) {
  const safe = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return safe || "ticket";
}

function buildTicketChannelName(displayName, reasonLabel, ticketNumber) {
  const suffix = `-${ticketNumber}`;
  const userPart = sanitizeName(displayName).slice(0, 45) || "membre";
  const reasonPart = sanitizeName(reasonLabel).slice(0, 35) || "autres";

  let channelName = `${userPart}-${reasonPart}${suffix}`;
  if (channelName.length <= 100) {
    return channelName;
  }

  const maxUserLen = Math.max(5, 100 - (reasonPart.length + suffix.length + 1));
  const trimmedUserPart = userPart.slice(0, maxUserLen);
  channelName = `${trimmedUserPart}-${reasonPart}${suffix}`;
  return channelName.slice(0, 100).replace(/-+$/g, "");
}

async function resolveStaffRoleIds(guild) {
  await guild.roles.fetch().catch(() => null);
  const roleIds = [];

  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id) {
      continue;
    }

    if (
      role.permissions.has(PermissionFlagsBits.Administrator) ||
      role.permissions.has(PermissionFlagsBits.ManageChannels) ||
      role.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      roleIds.push(role.id);
    }
  }

  return roleIds;
}

async function buildTicketPermissionOverwrites(guild, ownerId) {
  const staffRoleIds = await resolveStaffRoleIds(guild);
  const botMemberId = guild.members.me?.id || guild.client.user?.id;
  if (!botMemberId) {
    throw new Error("Bot member introuvable pour configurer les permissions ticket.");
  }

  const overwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AddReactions,
      ],
    },
    {
      id: botMemberId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];

  for (const roleId of staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }

  return overwrites;
}

async function findExistingHubMessage(channel, botId) {
  const messages = await channel.messages.fetch({ limit: 75 }).catch(() => null);
  if (!messages) {
    return null;
  }

  return (
    messages.find((message) => {
      if (message.author?.id !== botId) {
        return false;
      }

      return message.components.some((row) =>
        row.components.some((component) => component.customId === OPEN_TICKET_SELECT_ID)
      );
    }) || null
  );
}

async function ensureHubMessage(client) {
  const channel = await getSupportChannel(client);
  if (!channel) {
    console.error(`[TICKET] Salon support invalide ou introuvable (${SUPPORT_CHANNEL_ID}).`);
    return null;
  }

  const payload = buildHubPayload();
  const state = readJsonFile(HUB_STATE_FILE, null);

  if (
    state &&
    state.guildId === channel.guild.id &&
    state.channelId === channel.id &&
    state.messageId
  ) {
    const message = await channel.messages.fetch(state.messageId).catch(() => null);
    if (message) {
      await message.edit(payload).catch(() => null);
      return message;
    }
  }

  const existing = await findExistingHubMessage(channel, client.user.id);
  if (existing) {
    await existing.edit(payload).catch(() => null);
    writeJsonFile(HUB_STATE_FILE, {
      guildId: channel.guild.id,
      channelId: channel.id,
      messageId: existing.id,
    });
    return existing;
  }

  const sent = await channel.send(payload);
  writeJsonFile(HUB_STATE_FILE, {
    guildId: channel.guild.id,
    channelId: channel.id,
    messageId: sent.id,
  });
  return sent;
}

async function updateTicketPanelMessage(client, ticket) {
  if (!ticket.panelMessageId) {
    return null;
  }

  const message = await fetchTextMessage(client, ticket.channelId, ticket.panelMessageId);
  if (!message) {
    return null;
  }

  await message.edit(buildTicketPanelPayload(ticket)).catch(() => null);
  return message;
}

async function refreshStoredTickets(client) {
  let changed = false;

  for (const ticket of ticketStore.values()) {
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      ticketStore.delete(ticket.channelId);
      changed = true;
      continue;
    }

    const updated = await updateTicketPanelMessage(client, ticket);
    if (updated) {
      continue;
    }

    const sent = await channel
      .send({
        content: `<@${ticket.ownerId}>`,
        ...buildTicketPanelPayload(ticket),
        allowedMentions: { parse: [] },
      })
      .catch(() => null);

    if (sent) {
      ticket.panelMessageId = sent.id;
      changed = true;
    }
  }

  if (changed) {
    saveTicketStore();
  }
}

function getReasonData(value) {
  const reason = reasonByValue.get(value);
  if (reason) {
    return reason;
  }
  return reasonByValue.get("autres");
}

function canUseSupportSelectInChannel(interaction) {
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    return "Salon invalide pour ouvrir un ticket.";
  }

  if (interaction.channel.id !== SUPPORT_CHANNEL_ID) {
    return `Ce menu fonctionne uniquement dans <#${SUPPORT_CHANNEL_ID}>.`;
  }

  const botMember = interaction.guild?.members?.me;
  if (!botMember) {
    return "Membre bot introuvable.";
  }

  const perms = interaction.channel.permissionsFor(botMember);
  const ok =
    perms?.has(PermissionFlagsBits.ViewChannel) &&
    perms?.has(PermissionFlagsBits.SendMessages) &&
    perms?.has(PermissionFlagsBits.ManageChannels);

  if (!ok) {
    return "Permissions bot manquantes: ViewChannel, SendMessages, ManageChannels.";
  }

  return null;
}

async function createTicketFromSelect(interaction) {
  const checkError = canUseSupportSelectInChannel(interaction);
  if (checkError) {
    await interaction.reply({
      content: checkError,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedReasonValue = interaction.values?.[0];
  const reason = getReasonData(selectedReasonValue);
  if (!reason) {
    await interaction.reply({
      content: "Raison de ticket invalide.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const guild = interaction.guild;
    const memberDisplayName = interaction.member?.displayName || interaction.user.username;
    const ticketNumber = nextTicketNumber();
    const channelName = buildTicketChannelName(
      memberDisplayName,
      reason.label,
      ticketNumber
    );

    const permissionOverwrites = await buildTicketPermissionOverwrites(
      guild,
      interaction.user.id
    );

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: SUPPORT_TICKET_CATEGORY_ID,
      topic: `Ticket #${ticketNumber} ${reason.label} | ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites,
      reason: `Ticket ouvert par ${interaction.user.tag} (${reason.label})`,
    });

    const ticket = {
      channelId: ticketChannel.id,
      guildId: guild.id,
      ownerId: interaction.user.id,
      ticketNumber,
      reasonValue: reason.value,
      reasonLabel: `${reason.emoji} ${reason.label}`,
      claimedById: null,
      status: "open",
      panelMessageId: null,
      createdAt: Date.now(),
    };

    const panelMessage = await ticketChannel.send({
      content: `<@${interaction.user.id}>`,
      ...buildTicketPanelPayload(ticket),
      allowedMentions: { users: [interaction.user.id], parse: [] },
    });

    ticket.panelMessageId = panelMessage.id;
    ticketStore.set(ticket.channelId, ticket);
    saveTicketStore();

    await interaction.editReply({
      content: `Ticket cree: <#${ticketChannel.id}>`,
    });
  } catch (error) {
    console.error("[TICKET] Echec creation ticket");
    console.error(error);
    await interaction.editReply({
      content: "Impossible de creer le ticket pour le moment.",
    });
  }
}

async function setOwnerSendPermission(channel, ownerId, allowSend, reason) {
  await channel.permissionOverwrites
    .edit(ownerId, {
      SendMessages: allowSend,
    }, { reason })
    .catch(() => null);
}

async function handleClaim(interaction, ticket) {
  if (!isTicketStaff(interaction)) {
    await interaction.reply({
      content: "Seul un staff peut claim ce ticket.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (ticket.claimedById) {
    const claimBy = ticket.claimedById === interaction.user.id
      ? "Tu as deja claim ce ticket."
      : `Ticket deja claim par <@${ticket.claimedById}>.`;
    await interaction.reply({
      content: claimBy,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ticket.claimedById = interaction.user.id;
  saveTicketStore();

  await interaction.deferUpdate();
  await updateTicketPanelMessage(interaction.client, ticket);

  await interaction.followUp({
    content: `Ticket claim par <@${interaction.user.id}>.`,
    allowedMentions: { users: [interaction.user.id], parse: [] },
  });
}

async function handleClose(interaction, ticket) {
  const isOwner = interaction.user.id === ticket.ownerId;
  if (!isOwner && !isTicketStaff(interaction)) {
    await interaction.reply({
      content: "Seul le createur du ticket ou un staff peut le fermer.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (ticket.status === "closed") {
    await interaction.reply({
      content: "Ce ticket est deja ferme.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ticket.status = "closed";
  saveTicketStore();

  await setOwnerSendPermission(
    interaction.channel,
    ticket.ownerId,
    false,
    `Ticket ferme par ${interaction.user.tag}`
  );

  await interaction.deferUpdate();
  await updateTicketPanelMessage(interaction.client, ticket);

  await interaction.followUp({
    content: `Ticket ferme par <@${interaction.user.id}>.`,
    allowedMentions: { users: [interaction.user.id], parse: [] },
  });
}

async function handleDelete(interaction, ticket) {
  if (!isTicketStaff(interaction)) {
    await interaction.reply({
      content: "Seul un staff peut supprimer ce ticket.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ticketStore.delete(ticket.channelId);
  saveTicketStore();

  await interaction.reply({
    content: "Suppression du ticket...",
    flags: MessageFlags.Ephemeral,
  });

  await interaction.channel
    .delete(`Ticket supprime par ${interaction.user.tag}`)
    .catch(() => null);
}

async function handleTicketButton(interaction) {
  const ticket = ticketStore.get(interaction.channelId);
  if (!ticket) {
    await interaction.reply({
      content: "Ticket introuvable ou deja supprime.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.customId === TICKET_BUTTON_CLAIM_ID) {
    await handleClaim(interaction, ticket);
    return;
  }

  if (interaction.customId === TICKET_BUTTON_CLOSE_ID) {
    await handleClose(interaction, ticket);
    return;
  }

  if (interaction.customId === TICKET_BUTTON_DELETE_ID) {
    await handleDelete(interaction, ticket);
  }
}

module.exports = {
  name: "feature:ticket-system",
  async init(client) {
    const maxTicketNumberFromStore = loadTicketStore();
    loadTicketMeta(maxTicketNumberFromStore);

    client.once("clientReady", async () => {
      if (!hasConfiguredGuildId(client)) {
        console.warn("[TICKET] DISCORD_GUILD_ID absent, feature ignoree.");
        return;
      }

      await ensureHubMessage(client);
      await refreshStoredTickets(client);
    });

    client.on("interactionCreate", async (interaction) => {
      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === OPEN_TICKET_SELECT_ID
      ) {
        await createTicketFromSelect(interaction);
        return;
      }

      if (
        interaction.isButton() &&
        [
          TICKET_BUTTON_CLAIM_ID,
          TICKET_BUTTON_CLOSE_ID,
          TICKET_BUTTON_DELETE_ID,
        ].includes(interaction.customId)
      ) {
        await handleTicketButton(interaction);
      }
    });
  },
};
