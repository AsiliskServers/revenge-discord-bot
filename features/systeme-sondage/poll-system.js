const path = require("node:path");
const crypto = require("node:crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  deleteGuildCommand,
  fetchConfiguredGuild,
  fetchGuildTextChannel,
  fetchTextMessage,
  findBotMessageByComponent,
  hasConfiguredGuildId,
  readJsonFile,
  replyEphemeral,
  upsertGuildCommand,
  writeJsonFile,
} = require("../_shared/common");

const POLL_CHANNEL_ID = "1472915570935726242";
const DECISION_COMMAND_NAME = "decision-suggestion";
const LEGACY_COMMAND_NAME = "sondage";
const MAX_ACTIVE_SUGGESTIONS_PER_USER = 2;

const CREATE_POLL_BUTTON_ID = "poll_create_thread";
const CREATE_POLL_MODAL_ID = "poll_create_thread_modal";
const TITLE_INPUT_ID = "poll_title";
const FIRST_MESSAGE_INPUT_ID = "poll_first_message";

const VOTE_FOR_PREFIX = "poll_vote_for:";
const VOTE_AGAINST_PREFIX = "poll_vote_against:";
const CLOSE_SUGGESTION_PREFIX = "poll_close:";

const RUNTIME_DIR = path.join(__dirname, ".runtime");
const HUB_STATE_FILE = path.join(RUNTIME_DIR, "poll-hub-message.json");
const POLLS_STATE_FILE = path.join(RUNTIME_DIR, "polls-state.json");

const pollStore = new Map();

function shortText(value, limit) {
  const text = String(value || "").trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function toPercent(part, total) {
  if (!total) {
    return 0;
  }
  return Math.round((part / total) * 100);
}

function toPollRecord(raw) {
  if (!raw || !raw.id || !raw.channelId || !raw.messageId) {
    return null;
  }

  return {
    id: String(raw.id),
    guildId: String(raw.guildId || ""),
    channelId: String(raw.channelId || ""),
    messageId: String(raw.messageId || ""),
    threadId: raw.threadId ? String(raw.threadId) : null,
    authorId: String(raw.authorId || ""),
    title: String(raw.title || "Suggestion"),
    body: String(raw.body || ""),
    votesFor: Array.isArray(raw.votesFor) ? raw.votesFor.map(String) : [],
    votesAgainst: Array.isArray(raw.votesAgainst) ? raw.votesAgainst.map(String) : [],
    locked: Boolean(raw.locked),
    decisionReason: String(raw.decisionReason || ""),
    decidedById: raw.decidedById ? String(raw.decidedById) : null,
    decidedAt: Number(raw.decidedAt || 0),
    createdAt: Number(raw.createdAt || Date.now()),
  };
}

function createPollObject({ guildId, channelId, authorId, title, body }) {
  return {
    id: crypto.randomBytes(6).toString("hex"),
    guildId: String(guildId),
    channelId: String(channelId),
    messageId: "",
    threadId: null,
    authorId: String(authorId),
    title: shortText(title || "Suggestion", 250),
    body: String(body || "").trim(),
    votesFor: [],
    votesAgainst: [],
    locked: false,
    decisionReason: "",
    decidedById: null,
    decidedAt: 0,
    createdAt: Date.now(),
  };
}

function loadPollStore() {
  pollStore.clear();
  const raw = readJsonFile(POLLS_STATE_FILE, []);
  for (const item of raw) {
    const poll = toPollRecord(item);
    if (poll) {
      pollStore.set(poll.id, poll);
    }
  }
}

function savePollStore() {
  writeJsonFile(POLLS_STATE_FILE, Array.from(pollStore.values()));
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

async function followUpEphemeral(interaction, content) {
  await interaction.followUp({
    content,
    flags: MessageFlags.Ephemeral,
  });
}

async function getPollChannel(client) {
  const guild = await fetchConfiguredGuild(client);
  if (!guild) {
    return null;
  }

  const channel = await fetchGuildTextChannel(guild, POLL_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return null;
  }

  return channel;
}

function buildHubPayload(client) {
  const botAvatarUrl =
    typeof client?.user?.displayAvatarURL === "function"
      ? client.user.displayAvatarURL()
      : null;

  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setDescription(
      "Pour poster une nouvelle suggestion, réagissez avec le bouton de ce message. 📥\n\n" +
        "⚠️ Vous êtes limité à deux suggestions par personne tant que la décision de la suggestion n'est pas prise."
    );

  if (botAvatarUrl) {
    embed.setAuthor({
      name: "Nouvelle suggestion",
      iconURL: botAvatarUrl,
    });
  } else {
    embed.setTitle("Nouvelle suggestion");
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CREATE_POLL_BUTTON_ID)
          .setStyle(ButtonStyle.Danger)
          .setLabel("Créer une suggestion")
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

function buildCreatePollModal() {
  const modal = new ModalBuilder()
    .setCustomId(CREATE_POLL_MODAL_ID)
    .setTitle("Nouvelle suggestion");

  const titleInput = new TextInputBuilder()
    .setCustomId(TITLE_INPUT_ID)
    .setLabel("Titre")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(90)
    .setPlaceholder("Ex: Ajouter un nouveau mode de recrutement");

  const firstMessageInput = new TextInputBuilder()
    .setCustomId(FIRST_MESSAGE_INPUT_ID)
    .setLabel("Premier message")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1500)
    .setPlaceholder("Explique ton idée ici.");

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(firstMessageInput)
  );

  return modal;
}

function buildPollEmbed(poll) {
  const votesFor = poll.votesFor.length;
  const votesAgainst = poll.votesAgainst.length;
  const total = votesFor + votesAgainst;
  const percentFor = toPercent(votesFor, total);
  const percentAgainst = toPercent(votesAgainst, total);
  const decisionStatus = poll.locked ? "Verrouillée" : "En attente";
  const decisionText = shortText(
    poll.decisionReason || "Aucune décision pour le moment.",
    900
  ).replace(/`/g, "'");
  const decisionBy = poll.decidedById ? `\n\nPar:\n<@${poll.decidedById}>` : "";

  return new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle(shortText(poll.title, 250))
    .setDescription(shortText(poll.body, 1000))
    .addFields(
      {
        name: "Auteur",
        value: `<@${poll.authorId}>`,
        inline: true,
      },
      {
        name: "Suggestion",
        value: poll.threadId ? `<#${poll.threadId}>` : "Création suggestion...",
        inline: true,
      },
      {
        name: "Statut",
        value: decisionStatus,
        inline: true,
      },
      {
        name: "Suivi des votes",
        value: "✅ **Vote Pour**\n" + `\`${votesFor}\`\n\n` + "❌ **Vote Contre**\n" + `\`${votesAgainst}\``,
        inline: false,
      },
      {
        name: "Participation",
        value: `Total: ${total} | Pour: ${percentFor}% | Contre: ${percentAgainst}%`,
        inline: false,
      },
      {
        name: "👮‍♂️ Décision du taff",
        value: `\`${decisionText}\`${decisionBy}`,
        inline: false,
      }
    )
    .setFooter({ text: `ID sondage : ${poll.id}` });
}

function buildPollPayload(poll) {
  return {
    embeds: [buildPollEmbed(poll)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${VOTE_FOR_PREFIX}${poll.id}`)
          .setStyle(ButtonStyle.Success)
          .setLabel(`Pour (${poll.votesFor.length})`)
          .setDisabled(Boolean(poll.locked)),
        new ButtonBuilder()
          .setCustomId(`${VOTE_AGAINST_PREFIX}${poll.id}`)
          .setStyle(ButtonStyle.Danger)
          .setLabel(`Contre (${poll.votesAgainst.length})`)
          .setDisabled(Boolean(poll.locked))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CLOSE_SUGGESTION_PREFIX}${poll.id}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Fermer ma suggestion")
          .setDisabled(Boolean(poll.locked))
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

function countUserActiveSuggestions(guildId, userId) {
  let count = 0;
  for (const poll of pollStore.values()) {
    if (poll.guildId !== String(guildId)) {
      continue;
    }
    if (poll.authorId !== String(userId)) {
      continue;
    }
    if (poll.locked) {
      continue;
    }
    count += 1;
  }
  return count;
}

async function findExistingHubMessage(channel, botId) {
  return findBotMessageByComponent(channel, botId, {
    exactId: CREATE_POLL_BUTTON_ID,
    limit: 75,
  });
}

async function ensureHubMessage(client) {
  const channel = await getPollChannel(client);
  if (!channel) {
    console.error(`[POLL] Salon invalide ou introuvable (${POLL_CHANNEL_ID}).`);
    return null;
  }

  const payload = buildHubPayload(client);
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

async function bumpHubMessageToBottom(client, channel) {
  const targetChannel = channel || (await getPollChannel(client));
  if (!targetChannel) {
    return null;
  }

  const state = readHubState();
  let existing = null;

  if (
    state &&
    state.guildId === targetChannel.guild.id &&
    state.channelId === targetChannel.id &&
    state.messageId
  ) {
    existing = await targetChannel.messages.fetch(state.messageId).catch(() => null);
  }

  if (!existing) {
    existing = await findExistingHubMessage(targetChannel, client.user.id);
  }

  if (existing) {
    await existing.delete().catch(() => null);
  }

  const sent = await targetChannel.send(buildHubPayload(client));
  writeHubState(sent);
  return sent;
}

function canCreateSuggestionInChannel(interaction) {
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    return "Salon invalide pour créer une suggestion.";
  }

  if (interaction.channel.id !== POLL_CHANNEL_ID) {
    return `Ce système fonctionne uniquement dans <#${POLL_CHANNEL_ID}>.`;
  }

  const botMember = interaction.guild?.members?.me;
  if (!botMember) {
    return "Membre bot introuvable.";
  }

  const perms = interaction.channel.permissionsFor(botMember);
  const ok =
    perms?.has(PermissionFlagsBits.ViewChannel) &&
    perms?.has(PermissionFlagsBits.SendMessages) &&
    perms?.has(PermissionFlagsBits.CreatePublicThreads) &&
    perms?.has(PermissionFlagsBits.SendMessagesInThreads) &&
    perms?.has(PermissionFlagsBits.ManageThreads);

  if (!ok) {
    return "Permissions bot manquantes : ViewChannel, SendMessages, CreatePublicThreads, SendMessagesInThreads, ManageThreads.";
  }

  return null;
}

async function lockSuggestionThread(client, poll, reason) {
  if (!poll.threadId) {
    return;
  }

  const thread = await client.channels.fetch(poll.threadId).catch(() => null);
  if (!thread || !thread.isThread()) {
    return;
  }

  await thread.setArchived(true, reason).catch(() => null);
  await thread.setLocked(true, reason).catch(() => null);
}

async function updateStoredPollMessage(client, poll) {
  const message = await fetchTextMessage(client, poll.channelId, poll.messageId);
  if (!message) {
    return null;
  }

  await message.edit(buildPollPayload(poll)).catch(() => null);
  return message;
}

function closePoll({ poll, reason, closedById }) {
  poll.locked = true;
  poll.decisionReason = reason;
  poll.decidedById = closedById;
  poll.decidedAt = Date.now();
  savePollStore();
}

async function createSuggestionFromModal(interaction) {
  const checkError = canCreateSuggestionInChannel(interaction);
  if (checkError) {
    await replyEphemeral(interaction, checkError);
    return;
  }

  const title = interaction.fields.getTextInputValue(TITLE_INPUT_ID).trim();
  const firstMessage = interaction.fields.getTextInputValue(FIRST_MESSAGE_INPUT_ID).trim();

  if (
    countUserActiveSuggestions(interaction.guildId, interaction.user.id) >=
    MAX_ACTIVE_SUGGESTIONS_PER_USER
  ) {
    await replyEphemeral(
      interaction,
      `Tu as déjà ${MAX_ACTIVE_SUGGESTIONS_PER_USER} suggestion(s) active(s). ` +
        "Attends une décision du staff sur l'une d'elles pour en créer une nouvelle."
    );
    return;
  }

  const poll = createPollObject({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    authorId: interaction.user.id,
    title,
    body: firstMessage,
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const pollMessage = await interaction.channel.send(buildPollPayload(poll));
    poll.messageId = pollMessage.id;

    const thread = await pollMessage.startThread({
      name: shortText(poll.title, 100),
      autoArchiveDuration: 10080,
      reason: `Suggestion créée par ${interaction.user.tag}`,
    });

    await thread.setArchived(false).catch(() => null);
    await thread.setLocked(false).catch(() => null);
    poll.threadId = thread.id;

    await thread.send({
      content: `Suggestion de <@${interaction.user.id}>:\n${poll.body}\n\nVote en cliquant sur les boutons du message principal.`,
      allowedMentions: { users: [interaction.user.id] },
    });

    pollStore.set(poll.id, poll);
    savePollStore();

    await updateStoredPollMessage(interaction.client, poll);
    await bumpHubMessageToBottom(interaction.client, interaction.channel).catch(() => null);

    await interaction.editReply({
      content: `Suggestion créée. Discussion : <#${thread.id}>`,
    });
  } catch (error) {
    console.error("[POLL] Échec création suggestion");
    console.error(error);
    await interaction.editReply({
      content: "Impossible de créer la suggestion pour le moment.",
    });
  }
}

function applyVote(poll, userId, voteType) {
  const forSet = new Set(poll.votesFor);
  const againstSet = new Set(poll.votesAgainst);

  if (voteType === "for") {
    if (forSet.has(userId)) {
      forSet.delete(userId);
      poll.votesFor = Array.from(forSet);
      poll.votesAgainst = Array.from(againstSet);
      return "removed_for";
    }

    forSet.add(userId);
    againstSet.delete(userId);
    poll.votesFor = Array.from(forSet);
    poll.votesAgainst = Array.from(againstSet);
    return "added_for";
  }

  if (againstSet.has(userId)) {
    againstSet.delete(userId);
    poll.votesFor = Array.from(forSet);
    poll.votesAgainst = Array.from(againstSet);
    return "removed_against";
  }

  againstSet.add(userId);
  forSet.delete(userId);
  poll.votesFor = Array.from(forSet);
  poll.votesAgainst = Array.from(againstSet);
  return "added_against";
}

async function handleVoteButton(interaction, voteType) {
  const prefix = voteType === "for" ? VOTE_FOR_PREFIX : VOTE_AGAINST_PREFIX;
  const pollId = interaction.customId.slice(prefix.length);
  const poll = pollStore.get(pollId);

  if (!poll) {
    await replyEphemeral(interaction, "Ce sondage n'existe plus.");
    return;
  }

  if (interaction.user.bot) {
    await replyEphemeral(interaction, "Action non autorisée.");
    return;
  }

  if (poll.locked) {
    await replyEphemeral(interaction, "Cette suggestion est déjà verrouillée.");
    return;
  }

  const result = applyVote(poll, interaction.user.id, voteType);
  savePollStore();

  await interaction.deferUpdate();
  await updateStoredPollMessage(interaction.client, poll);

  let info = "Vote pris en compte.";
  if (result === "added_for") {
    info = "Tu as voté Pour.";
  } else if (result === "added_against") {
    info = "Tu as voté Contre.";
  } else if (result === "removed_for" || result === "removed_against") {
    info = "Ton vote a été retiré.";
  }

  await followUpEphemeral(interaction, info);
}

async function handleCloseSuggestionButton(interaction) {
  const pollId = interaction.customId.slice(CLOSE_SUGGESTION_PREFIX.length);
  const poll = pollStore.get(pollId);

  if (!poll) {
    await replyEphemeral(interaction, "Suggestion introuvable.");
    return;
  }

  if (interaction.user.id !== poll.authorId) {
    await replyEphemeral(interaction, "Seul le créateur de la suggestion peut la fermer.");
    return;
  }

  if (poll.locked) {
    await replyEphemeral(interaction, "Cette suggestion est déjà fermée.");
    return;
  }

  closePoll({
    poll,
    reason: "Suggestion fermée par son créateur.",
    closedById: interaction.user.id,
  });

  await lockSuggestionThread(
    interaction.client,
    poll,
    `Suggestion fermée par ${interaction.user.tag}`
  );

  await interaction.deferUpdate();
  await updateStoredPollMessage(interaction.client, poll);

  await followUpEphemeral(
    interaction,
    "Suggestion fermée. Tu peux maintenant en créer une autre si tu étais à la limite."
  );
}

async function registerDecisionCommand(client) {
  const command = new SlashCommandBuilder()
    .setName(DECISION_COMMAND_NAME)
    .setDescription("Verrouille une suggestion avec une décision staff")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("ID de la suggestion (visible en bas de l'embed)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("raison")
        .setDescription("Décision / raison staff")
        .setRequired(true)
        .setMaxLength(900)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

  await upsertGuildCommand({
    client,
    commandName: DECISION_COMMAND_NAME,
    commandJson: command.toJSON(),
    logPrefix: "POLL",
    missingGuildLog: `DISCORD_GUILD_ID absent, /${DECISION_COMMAND_NAME} non enregistré.`,
  });
}

async function handleDecisionCommand(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await replyEphemeral(interaction, "Permission requise: ManageMessages.");
    return;
  }

  const pollId = interaction.options.getString("id", true).trim();
  const reason = interaction.options.getString("raison", true).trim();
  const poll = pollStore.get(pollId);

  if (!poll) {
    await replyEphemeral(interaction, "Suggestion introuvable.");
    return;
  }

  closePoll({
    poll,
    reason,
    closedById: interaction.user.id,
  });

  await lockSuggestionThread(
    interaction.client,
    poll,
    `Suggestion fermée par ${interaction.user.tag}`
  );

  await updateStoredPollMessage(interaction.client, poll);

  await interaction.reply({
    content: `Suggestion \`${poll.id}\` verrouillée avec la décision staff.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function refreshStoredPollMessages(client) {
  for (const poll of pollStore.values()) {
    await updateStoredPollMessage(client, poll);
  }
}

module.exports = {
  name: "feature:poll-system",
  async init(client) {
    loadPollStore();

    client.once("clientReady", async () => {
      if (!hasConfiguredGuildId(client)) {
        console.warn("[POLL] DISCORD_GUILD_ID absent, feature ignorée.");
        return;
      }

      await deleteGuildCommand({
        client,
        commandName: LEGACY_COMMAND_NAME,
        logPrefix: "POLL",
        failLog: "Failed to remove legacy /sondage command",
      });

      await registerDecisionCommand(client);
      await ensureHubMessage(client);
      await refreshStoredPollMessages(client);
    });

    client.on("interactionCreate", async (interaction) => {
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === DECISION_COMMAND_NAME
      ) {
        await handleDecisionCommand(interaction);
        return;
      }

      if (interaction.isButton() && interaction.customId === CREATE_POLL_BUTTON_ID) {
      if (interaction.channelId !== POLL_CHANNEL_ID) {
          await replyEphemeral(
            interaction,
            `Ce bouton fonctionne uniquement dans <#${POLL_CHANNEL_ID}>.`
          );
          return;
        }

        await interaction.showModal(buildCreatePollModal());
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith(VOTE_FOR_PREFIX)) {
        await handleVoteButton(interaction, "for");
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(VOTE_AGAINST_PREFIX)
      ) {
        await handleVoteButton(interaction, "against");
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(CLOSE_SUGGESTION_PREFIX)
      ) {
        await handleCloseSuggestionButton(interaction);
        return;
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId === CREATE_POLL_MODAL_ID
      ) {
        await createSuggestionFromModal(interaction);
      }
    });
  },
};
