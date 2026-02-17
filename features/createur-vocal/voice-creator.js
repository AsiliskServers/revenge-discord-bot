const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  fetchConfiguredGuild,
  hasConfiguredGuildId,
} = require("../_shared/common");

const VOICE_CREATOR_CHANNEL_ID = "1473103122321903789";
const VOICE_TARGET_CATEGORY_ID = "1382993339728789595";
const EMPTY_DELETE_DELAY_MS = 5000;

const PANEL_BTN_OPEN = "vc_panel_open";
const PANEL_BTN_CLOSED = "vc_panel_closed";
const PANEL_BTN_PRIVATE = "vc_panel_private";
const PANEL_BTN_MIC = "vc_panel_mic";
const PANEL_BTN_VIDEO = "vc_panel_video";
const PANEL_BTN_LIMIT = "vc_panel_limit";
const PANEL_BTN_TRANSFER = "vc_panel_transfer";

const LIMIT_MODAL_PREFIX = "vc_limit_modal:";
const TRANSFER_MODAL_PREFIX = "vc_transfer_modal:";
const LIMIT_FIELD_ID = "vc_limit_value";
const TRANSFER_FIELD_ID = "vc_transfer_value";

const MODE_OPEN = "open";
const MODE_CLOSED = "closed";
const MODE_PRIVATE = "private";

const tempVoiceStateByChannelId = new Map();

function sanitizeName(value) {
  const safe = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return safe || "vocal";
}

function getModeLabel(mode) {
  if (mode === MODE_CLOSED) {
    return "Ferme";
  }
  if (mode === MODE_PRIVATE) {
    return "Prive";
  }
  return "Ouvert";
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
      role.permissions.has(PermissionFlagsBits.MoveMembers)
    ) {
      roleIds.push(role.id);
    }
  }

  return roleIds;
}

async function buildVoiceOverwrites(guild, state) {
  const staffRoleIds = await resolveStaffRoleIds(guild);
  const botMemberId = guild.members.me?.id || guild.client.user?.id;
  if (!botMemberId) {
    throw new Error("Bot member introuvable pour les permissions vocales.");
  }

  const everyoneAllow = [];
  const everyoneDeny = [];

  if (state.mode === MODE_OPEN) {
    everyoneAllow.push(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect);
  } else if (state.mode === MODE_CLOSED) {
    everyoneAllow.push(PermissionFlagsBits.ViewChannel);
    everyoneDeny.push(PermissionFlagsBits.Connect);
  } else {
    everyoneDeny.push(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect);
  }

  if (state.micBlocked) {
    everyoneDeny.push(PermissionFlagsBits.Speak);
  }
  if (state.videoBlocked) {
    everyoneDeny.push(PermissionFlagsBits.Stream);
  }

  const overwrites = [
    {
      id: guild.id,
      allow: everyoneAllow,
      deny: everyoneDeny,
    },
    {
      id: state.ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: botMemberId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  for (const roleId of staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  return overwrites;
}

function buildPanelEmbed(state) {
  const limitLabel = state.userLimit > 0 ? String(state.userLimit) : "Illimite";
  const micLabel = state.micBlocked ? "Micro bloque" : "Micro autorise";
  const videoLabel = state.videoBlocked ? "Video bloquee" : "Video autorisee";

  return new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("Configuration du salon")
    .setDescription(
      `Proprietaire du salon : <@${state.ownerId}>\n\n` +
        "Voici l'espace de configuration de votre salon vocal temporaire. " +
        "Utilisez les controles ci-dessous pour gerer rapidement votre salon."
    )
    .addFields(
      {
        name: "Mode",
        value: `\`${getModeLabel(state.mode)}\``,
        inline: true,
      },
      {
        name: "Micro",
        value: `\`${micLabel}\``,
        inline: true,
      },
      {
        name: "Video",
        value: `\`${videoLabel}\``,
        inline: true,
      },
      {
        name: "Limite membres",
        value: `\`${limitLabel}\``,
        inline: true,
      },
      {
        name: "Transfert",
        value: "Transferez la propriete du salon a un autre membre.",
        inline: false,
      }
    );
}

function buildPanelComponents(state) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(PANEL_BTN_OPEN)
        .setStyle(state.mode === MODE_OPEN ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel("Ouvert"),
      new ButtonBuilder()
        .setCustomId(PANEL_BTN_CLOSED)
        .setStyle(state.mode === MODE_CLOSED ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setLabel("Ferme"),
      new ButtonBuilder()
        .setCustomId(PANEL_BTN_PRIVATE)
        .setStyle(state.mode === MODE_PRIVATE ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setLabel("Prive")
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(PANEL_BTN_MIC)
        .setStyle(state.micBlocked ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setLabel(state.micBlocked ? "Debloquer micro" : "Bloquer micro"),
      new ButtonBuilder()
        .setCustomId(PANEL_BTN_VIDEO)
        .setStyle(state.videoBlocked ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setLabel(state.videoBlocked ? "Debloquer video" : "Bloquer video")
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(PANEL_BTN_LIMIT)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Regler limite"),
      new ButtonBuilder()
        .setCustomId(PANEL_BTN_TRANSFER)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Transferer")
    ),
  ];
}

function buildPanelPayload(state) {
  return {
    embeds: [buildPanelEmbed(state)],
    components: buildPanelComponents(state),
    allowedMentions: { parse: [] },
  };
}

async function ensurePanelMessage(channel, state) {
  if (!channel?.isTextBased?.()) {
    return null;
  }

  const payload = buildPanelPayload(state);

  if (state.panelMessageId) {
    const existing = await channel.messages.fetch(state.panelMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => null);
      return existing;
    }
  }

  const sent = await channel.send(payload).catch(() => null);
  if (!sent) {
    return null;
  }

  state.panelMessageId = sent.id;
  return sent;
}

async function applyVoicePermissions(channel, state, reason) {
  const overwrites = await buildVoiceOverwrites(channel.guild, state);
  await channel.permissionOverwrites.set(overwrites, reason).catch(() => null);
}

function clearDeleteTimer(state) {
  if (!state?.deleteTimer) {
    return;
  }
  clearTimeout(state.deleteTimer);
  state.deleteTimer = null;
}

function isTempManagedChannel(channelId) {
  return tempVoiceStateByChannelId.has(channelId);
}

async function scheduleDeleteIfEmpty(channelId, guild) {
  const state = tempVoiceStateByChannelId.get(channelId);
  if (!state) {
    return;
  }
  if (state.deleteTimer) {
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    tempVoiceStateByChannelId.delete(channelId);
    return;
  }
  if (channel.members.size > 0) {
    return;
  }

  state.deleteTimer = setTimeout(async () => {
    const latest = tempVoiceStateByChannelId.get(channelId);
    if (!latest) {
      return;
    }

    const freshChannel = await guild.channels.fetch(channelId).catch(() => null);
    if (!freshChannel || freshChannel.type !== ChannelType.GuildVoice) {
      tempVoiceStateByChannelId.delete(channelId);
      return;
    }

    if (freshChannel.members.size > 0) {
      latest.deleteTimer = null;
      return;
    }

    tempVoiceStateByChannelId.delete(channelId);
    await freshChannel.delete("Salon vocal temporaire vide (auto-clean)").catch(() => null);
  }, EMPTY_DELETE_DELAY_MS);
}

function canManageVoicePanel(interaction, state) {
  return Boolean(
    interaction.user.id === state.ownerId ||
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
  );
}

function parseUserId(value) {
  const text = String(value || "").trim();
  const mentionMatch = text.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    return mentionMatch[1];
  }
  if (/^\d{17,25}$/.test(text)) {
    return text;
  }
  return null;
}

function buildLimitModal(channelId, currentLimit) {
  const modal = new ModalBuilder()
    .setCustomId(`${LIMIT_MODAL_PREFIX}${channelId}`)
    .setTitle("Regler la limite");

  const input = new TextInputBuilder()
    .setCustomId(LIMIT_FIELD_ID)
    .setLabel("Nombre max (0 a 99)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(currentLimit || 0))
    .setPlaceholder("0 pour illimite");

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildTransferModal(channelId) {
  const modal = new ModalBuilder()
    .setCustomId(`${TRANSFER_MODAL_PREFIX}${channelId}`)
    .setTitle("Transferer la propriete");

  const input = new TextInputBuilder()
    .setCustomId(TRANSFER_FIELD_ID)
    .setLabel("Mention ou ID du membre")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("@membre ou 123456789012345678");

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function createTempVoiceForMember(member) {
  const guild = member.guild;
  const prefix = "🔊・Salon de ";
  const rawMemberName = String(member.displayName || member.user.username || "Membre")
    .replace(/\s+/g, " ")
    .trim();
  const maxNameLength = Math.max(1, 100 - prefix.length);
  const clippedMemberName = rawMemberName.slice(0, maxNameLength) || "Membre";
  const channelName = `${prefix}${clippedMemberName}`;

  const state = {
    ownerId: member.id,
    mode: MODE_OPEN,
    micBlocked: false,
    videoBlocked: false,
    userLimit: 0,
    panelMessageId: null,
    deleteTimer: null,
  };

  const permissionOverwrites = await buildVoiceOverwrites(guild, state);
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildVoice,
    parent: VOICE_TARGET_CATEGORY_ID,
    userLimit: 0,
    permissionOverwrites,
    reason: `Salon vocal temporaire cree pour ${member.user.tag}`,
  });

  tempVoiceStateByChannelId.set(channel.id, state);

  await member.voice.setChannel(channel, "Creation du vocal temporaire").catch(() => null);
  await ensurePanelMessage(channel, state);
  return channel;
}

async function handleModeAction(interaction, state, mode) {
  state.mode = mode;
  await applyVoicePermissions(interaction.channel, state, `Mode change par ${interaction.user.tag}`);
  await ensurePanelMessage(interaction.channel, state);
  await interaction.deferUpdate();
}

async function handleToggleMic(interaction, state) {
  state.micBlocked = !state.micBlocked;
  await applyVoicePermissions(
    interaction.channel,
    state,
    `Blocage micro modifie par ${interaction.user.tag}`
  );
  await ensurePanelMessage(interaction.channel, state);
  await interaction.deferUpdate();
}

async function handleToggleVideo(interaction, state) {
  state.videoBlocked = !state.videoBlocked;
  await applyVoicePermissions(
    interaction.channel,
    state,
    `Blocage video modifie par ${interaction.user.tag}`
  );
  await ensurePanelMessage(interaction.channel, state);
  await interaction.deferUpdate();
}

async function handlePanelButton(interaction) {
  const state = tempVoiceStateByChannelId.get(interaction.channelId);
  if (!state) {
    await interaction.reply({
      content: "Ce panneau n'est plus actif.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!canManageVoicePanel(interaction, state)) {
    await interaction.reply({
      content: "Seul le proprietaire du salon peut utiliser ce panneau.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.customId === PANEL_BTN_OPEN) {
    await handleModeAction(interaction, state, MODE_OPEN);
    return;
  }

  if (interaction.customId === PANEL_BTN_CLOSED) {
    await handleModeAction(interaction, state, MODE_CLOSED);
    return;
  }

  if (interaction.customId === PANEL_BTN_PRIVATE) {
    await handleModeAction(interaction, state, MODE_PRIVATE);
    return;
  }

  if (interaction.customId === PANEL_BTN_MIC) {
    await handleToggleMic(interaction, state);
    return;
  }

  if (interaction.customId === PANEL_BTN_VIDEO) {
    await handleToggleVideo(interaction, state);
    return;
  }

  if (interaction.customId === PANEL_BTN_LIMIT) {
    await interaction.showModal(buildLimitModal(interaction.channelId, state.userLimit));
    return;
  }

  if (interaction.customId === PANEL_BTN_TRANSFER) {
    await interaction.showModal(buildTransferModal(interaction.channelId));
  }
}

async function handleLimitModal(interaction) {
  const channelId = interaction.customId.slice(LIMIT_MODAL_PREFIX.length);
  const state = tempVoiceStateByChannelId.get(channelId);
  if (!state) {
    await interaction.reply({
      content: "Salon temporaire introuvable.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!canManageVoicePanel(interaction, state)) {
    await interaction.reply({
      content: "Action reservee au proprietaire.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rawValue = interaction.fields.getTextInputValue(LIMIT_FIELD_ID).trim();
  if (!/^\d{1,2}$/.test(rawValue)) {
    await interaction.reply({
      content: "Entre une valeur numerique entre 0 et 99.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const limit = Number(rawValue);
  if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
    await interaction.reply({
      content: "La limite doit etre entre 0 et 99.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: "Salon vocal introuvable.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  state.userLimit = limit;
  await channel.setUserLimit(limit, `Limite modifiee par ${interaction.user.tag}`).catch(() => null);
  await ensurePanelMessage(channel, state);

  await interaction.reply({
    content: `Limite mise a jour: ${limit === 0 ? "illimite" : limit}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTransferModal(interaction) {
  const channelId = interaction.customId.slice(TRANSFER_MODAL_PREFIX.length);
  const state = tempVoiceStateByChannelId.get(channelId);
  if (!state) {
    await interaction.reply({
      content: "Salon temporaire introuvable.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!canManageVoicePanel(interaction, state)) {
    await interaction.reply({
      content: "Action reservee au proprietaire.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rawTarget = interaction.fields.getTextInputValue(TRANSFER_FIELD_ID);
  const targetUserId = parseUserId(rawTarget);
  if (!targetUserId) {
    await interaction.reply({
      content: "Mention ou ID invalide.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
  if (!member) {
    await interaction.reply({
      content: "Membre introuvable sur ce serveur.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (member.user.bot) {
    await interaction.reply({
      content: "Impossible de transferer a un bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: "Salon vocal introuvable.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  state.ownerId = member.id;
  await applyVoicePermissions(channel, state, `Propriete transferee par ${interaction.user.tag}`);
  await ensurePanelMessage(channel, state);

  await interaction.reply({
    content: `Propriete transferee a <@${member.id}>.`,
    allowedMentions: { users: [member.id], parse: [] },
    flags: MessageFlags.Ephemeral,
  });
}

async function handleVoiceStateUpdate(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user?.bot) {
    return;
  }

  if (
    newState.channelId === VOICE_CREATOR_CHANNEL_ID &&
    oldState.channelId !== VOICE_CREATOR_CHANNEL_ID
  ) {
    await createTempVoiceForMember(member).catch((error) => {
      console.error("[VOICE CREATOR] Echec creation du vocal temporaire");
      console.error(error);
    });
    return;
  }

  if (oldState.channelId && isTempManagedChannel(oldState.channelId)) {
    await scheduleDeleteIfEmpty(oldState.channelId, oldState.guild);
  }

  if (newState.channelId && isTempManagedChannel(newState.channelId)) {
    const state = tempVoiceStateByChannelId.get(newState.channelId);
    clearDeleteTimer(state);
  }
}

module.exports = {
  name: "feature:voice-creator",
  async init(client) {
    client.once("clientReady", async () => {
      if (!hasConfiguredGuildId(client)) {
        console.warn("[VOICE CREATOR] DISCORD_GUILD_ID absent, feature ignoree.");
        return;
      }

      const guild = await fetchConfiguredGuild(client);
      if (!guild) {
        console.warn("[VOICE CREATOR] Guild introuvable.");
        return;
      }

      const trigger = await guild.channels.fetch(VOICE_CREATOR_CHANNEL_ID).catch(() => null);
      if (!trigger || trigger.type !== ChannelType.GuildVoice) {
        console.warn(
          `[VOICE CREATOR] Salon createur invalide ou introuvable (${VOICE_CREATOR_CHANNEL_ID}).`
        );
      }
    });

    client.on("voiceStateUpdate", async (oldState, newState) => {
      await handleVoiceStateUpdate(oldState, newState);
    });

    client.on("interactionCreate", async (interaction) => {
      if (
        interaction.isButton() &&
        [
          PANEL_BTN_OPEN,
          PANEL_BTN_CLOSED,
          PANEL_BTN_PRIVATE,
          PANEL_BTN_MIC,
          PANEL_BTN_VIDEO,
          PANEL_BTN_LIMIT,
          PANEL_BTN_TRANSFER,
        ].includes(interaction.customId)
      ) {
        await handlePanelButton(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith(LIMIT_MODAL_PREFIX)) {
        await handleLimitModal(interaction);
        return;
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(TRANSFER_MODAL_PREFIX)
      ) {
        await handleTransferModal(interaction);
      }
    });
  },
};
