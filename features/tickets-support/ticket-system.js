const fs = require("node:fs");
const path = require("node:path");
const {
  AttachmentBuilder,
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
  findBotMessageByComponent,
  hasConfiguredGuildId,
  readJsonFile,
  replyEphemeral,
  writeJsonFile,
} = require("../_shared/common");

const SUPPORT_CHANNEL_ID = "996446504199917668";
const SUPPORT_TICKET_CATEGORY_ID = "1383247332908335207";
const TICKET_ARCHIVE_CHANNEL_ID = "1473114020717400270";

const OPEN_TICKET_SELECT_ID = "ticket_open_select";
const TICKET_BUTTON_CLAIM_ID = "ticket_claim";
const TICKET_BUTTON_CLOSE_ID = "ticket_close";
const TICKET_BUTTON_DELETE_ID = "ticket_delete";
const TICKET_BUTTON_IDS = new Set([
  TICKET_BUTTON_CLAIM_ID,
  TICKET_BUTTON_CLOSE_ID,
  TICKET_BUTTON_DELETE_ID,
]);

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
    description: "Signaler un comportement inapproprié",
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
    description: "Remonter un bug rencontré sur le serveur",
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
        console.log(`[TICKET] Image panel utilisée : ${candidate}`);
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

function readHubState() {
  const state = readJsonFile(HUB_STATE_FILE, null);
  if (!state || typeof state !== "object") {
    return null;
  }
  return state?.guildId && state?.channelId && state?.messageId ? state : null;
}

function writeHubState(message) {
  writeJsonFile(HUB_STATE_FILE, {
    guildId: message.guild.id,
    channelId: message.channelId,
    messageId: message.id,
  });
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return "-";
  }
  return new Date(timestamp).toISOString();
}

async function fetchAllMessages(channel) {
  const all = [];
  let before = undefined;

  while (true) {
    const batch = await channel.messages
      .fetch({ limit: 100, before })
      .catch(() => null);
    if (!batch || batch.size === 0) {
      break;
    }

    const entries = Array.from(batch.values());
    all.push(...entries);

    if (batch.size < 100) {
      break;
    }
    before = entries[entries.length - 1]?.id;
    if (!before) {
      break;
    }
  }

  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function buildTranscriptHtml({ ticket, channel, messages, deletedBy }) {
  const title = `Archive Ticket #${ticket.ticketNumber || "?"}`;
  const rows = messages
    .map((message) => {
      const authorTag = `${message.author?.tag || "Inconnu"} (${message.author?.id || "-"})`;
      const content = escapeHtml(message.content || "").replace(/\r?\n/g, "<br>");

      const attachments = Array.from(message.attachments.values());
      const attachmentHtml =
        attachments.length > 0
          ? `<div class=\"attachments\"><strong>Fichiers:</strong> ${attachments
              .map((att) => `<a href=\"${escapeHtml(att.url)}\" target=\"_blank\">${escapeHtml(att.name || "fichier")}</a>`)
              .join(" | ")}</div>`
          : "";

      const embeds = message.embeds || [];
      const embedHtml =
        embeds.length > 0
          ? `<div class=\"embeds\"><strong>Embeds:</strong> ${embeds
              .map((embed) => {
                const parts = [];
                if (embed.title) {
                  parts.push(`<span class=\"embed-title\">${escapeHtml(embed.title)}</span>`);
                }
                if (embed.description) {
                  parts.push(`<span>${escapeHtml(embed.description)}</span>`);
                }
                return parts.join(" - ");
              })
              .join("<br>")}</div>`
          : "";

      return `
        <article class="msg">
          <header>
            <strong>${escapeHtml(authorTag)}</strong>
            <span>${escapeHtml(formatDateTime(message.createdTimestamp))}</span>
          </header>
          <div class="content">${content || "<em>(message vide)</em>"}</div>
          ${attachmentHtml}
          ${embedHtml}
        </article>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background:#0f1115; color:#f5f7ff; }
    h1 { margin: 0 0 8px 0; }
    .meta { margin-bottom: 20px; color: #c7cce0; }
    .msg { border:1px solid #2a3145; border-left:4px solid #e11d48; padding:10px; margin: 10px 0; background:#161b26; border-radius:6px; }
    .msg header { display:flex; justify-content:space-between; gap:8px; color:#aeb7d9; margin-bottom:8px; font-size: 13px; }
    .content { white-space: normal; line-height: 1.45; }
    .attachments, .embeds { margin-top:8px; font-size: 13px; color:#d7def8; }
    a { color:#7cb3ff; text-decoration:none; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <div><strong>Salon:</strong> ${escapeHtml(channel.name)} (${escapeHtml(channel.id)})</div>
    <div><strong>Propriétaire:</strong> ${escapeHtml(ticket.ownerId)}</div>
    <div><strong>Raison:</strong> ${escapeHtml(ticket.reasonLabel || ticket.reasonValue || "-")}</div>
    <div><strong>Créé le:</strong> ${escapeHtml(formatDateTime(ticket.createdAt))}</div>
    <div><strong>Supprimé par:</strong> ${escapeHtml(deletedBy?.tag || "-")} (${escapeHtml(deletedBy?.id || "-")})</div>
    <div><strong>Messages archivés:</strong> ${messages.length}</div>
  </div>
  ${rows || "<p>Aucun message à archiver.</p>"}
</body>
</html>`;
}

async function archiveTicketBeforeDelete(interaction, ticket) {
  const archiveChannel = await fetchGuildTextChannel(
    interaction.guild,
    TICKET_ARCHIVE_CHANNEL_ID
  );
  if (!archiveChannel || archiveChannel.type !== ChannelType.GuildText) {
    console.warn(
      `[TICKET] Salon archive introuvable/invalide (${TICKET_ARCHIVE_CHANNEL_ID}).`
    );
    return false;
  }

  const messages = await fetchAllMessages(interaction.channel);
  const html = buildTranscriptHtml({
    ticket,
    channel: interaction.channel,
    messages,
    deletedBy: interaction.user,
  });

  const fileName = `ticket-${ticket.ticketNumber || ticket.channelId}-${Date.now()}.html`;
  const attachment = new AttachmentBuilder(Buffer.from(html, "utf8"), {
    name: fileName,
  });

  await archiveChannel.send({
    content:
      `Archive ticket #${ticket.ticketNumber || "?"} - <#${ticket.channelId}> - ` +
      `propriétaire <@${ticket.ownerId}>`,
    files: [attachment],
    allowedMentions: { parse: [] },
  });

  return true;
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
    throw new Error("Membre bot introuvable pour configurer les permissions ticket.");
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
  return findBotMessageByComponent(channel, botId, {
    exactId: OPEN_TICKET_SELECT_ID,
    limit: 75,
  });
}

async function ensureHubMessage(client) {
  const channel = await getSupportChannel(client);
  if (!channel) {
    console.error(`[TICKET] Salon support invalide ou introuvable (${SUPPORT_CHANNEL_ID}).`);
    return null;
  }

  const payload = buildHubPayload();
  const state = readHubState();

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
    writeHubState(existing);
    return existing;
  }

  const sent = await channel.send(payload);
  writeHubState(sent);
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

async function followUpTicketAction(interaction, content) {
  await interaction.followUp({
    content,
    allowedMentions: { users: [interaction.user.id], parse: [] },
  });
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
    return "Permissions bot manquantes : ViewChannel, SendMessages, ManageChannels.";
  }

  return null;
}

async function createTicketFromSelect(interaction) {
  const checkError = canUseSupportSelectInChannel(interaction);
  if (checkError) {
    await replyEphemeral(interaction, checkError);
    return;
  }

  const selectedReasonValue = interaction.values?.[0];
  const reason = getReasonData(selectedReasonValue);
  if (!reason) {
    await replyEphemeral(interaction, "Raison de ticket invalide.");
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
      content: `Ticket créé : <#${ticketChannel.id}>`,
    });
  } catch (error) {
    console.error("[TICKET] Échec création ticket");
    console.error(error);
    await interaction.editReply({
      content: "Impossible de créer le ticket pour le moment.",
    });
  }
}

async function handleClaim(interaction, ticket) {
  if (!isTicketStaff(interaction)) {
    await replyEphemeral(interaction, "Seul un staff peut claim ce ticket.");
    return;
  }

  if (ticket.claimedById) {
    const claimBy = ticket.claimedById === interaction.user.id
      ? "Tu as déjà claim ce ticket."
      : `Ticket déjà claim par <@${ticket.claimedById}>.`;
    await replyEphemeral(interaction, claimBy);
    return;
  }

  ticket.claimedById = interaction.user.id;
  saveTicketStore();

  await interaction.deferUpdate();
  await updateTicketPanelMessage(interaction.client, ticket);

  await followUpTicketAction(interaction, `Ticket claim par <@${interaction.user.id}>.`);
}

async function handleClose(interaction, ticket) {
  const isOwner = interaction.user.id === ticket.ownerId;
  if (!isOwner && !isTicketStaff(interaction)) {
    await replyEphemeral(interaction, "Seul le créateur du ticket ou un staff peut le fermer.");
    return;
  }

  if (ticket.status === "closed") {
    await replyEphemeral(interaction, "Ce ticket est déjà fermé.");
    return;
  }

  ticket.status = "closed";
  saveTicketStore();

  await interaction.channel.permissionOverwrites
    .edit(
      ticket.ownerId,
      {
        SendMessages: false,
      },
      { reason: `Ticket fermé par ${interaction.user.tag}` }
    )
    .catch(() => null);

  await interaction.deferUpdate();
  await updateTicketPanelMessage(interaction.client, ticket);

  await followUpTicketAction(interaction, `Ticket fermé par <@${interaction.user.id}>.`);
}

async function handleDelete(interaction, ticket) {
  if (!isTicketStaff(interaction)) {
    await replyEphemeral(interaction, "Seul un staff peut supprimer ce ticket.");
    return;
  }

  try {
    await archiveTicketBeforeDelete(interaction, ticket);
  } catch (error) {
    console.error(`[TICKET] Échec archive ticket ${ticket.channelId}`);
    console.error(error);
  }

  ticketStore.delete(ticket.channelId);
  saveTicketStore();

  await replyEphemeral(interaction, "Suppression du ticket...");

  await interaction.channel
    .delete(`Ticket supprimé par ${interaction.user.tag}`)
    .catch(() => null);
}

async function handleTicketButton(interaction) {
  const ticket = ticketStore.get(interaction.channelId);
  if (!ticket) {
    await replyEphemeral(interaction, "Ticket introuvable ou déjà supprimé.");
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
        console.warn("[TICKET] DISCORD_GUILD_ID absent, feature ignorée.");
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
        TICKET_BUTTON_IDS.has(interaction.customId)
      ) {
        await handleTicketButton(interaction);
      }
    });
  },
};
