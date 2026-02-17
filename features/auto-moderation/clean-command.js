const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");
const { upsertGuildCommand } = require("../_shared/common");

const COMMAND_NAME = "clean";
const MODE_ALL = "all";
const MODE_BOT = "bot";
const MAX_DELETE = 100;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function hasBotPermissions(interaction) {
  const botMember = interaction.guild?.members?.me;
  if (!botMember) {
    return false;
  }

  const perms = interaction.channel?.permissionsFor(botMember);
  return Boolean(
    perms?.has(PermissionFlagsBits.ViewChannel) &&
      perms?.has(PermissionFlagsBits.ReadMessageHistory) &&
      perms?.has(PermissionFlagsBits.ManageMessages)
  );
}

async function collectCandidateMessages(channel, mode, wantedCount) {
  if (mode === MODE_ALL) {
    const recent = await channel.messages.fetch({ limit: wantedCount });
    return Array.from(recent.values());
  }

  const matches = [];
  const searchWindow = Math.min(1000, Math.max(200, wantedCount * 15));
  let scanned = 0;
  let beforeId = null;

  while (matches.length < wantedCount && scanned < searchWindow) {
    const pageSize = Math.min(100, searchWindow - scanned);
    const batch = await channel.messages.fetch({
      limit: pageSize,
      before: beforeId || undefined,
    });

    if (!batch.size) {
      break;
    }

    scanned += batch.size;
    beforeId = batch.lastKey();

    for (const message of batch.values()) {
      if (!message.author?.bot) {
        continue;
      }

      matches.push(message);
      if (matches.length >= wantedCount) {
        break;
      }
    }
  }

  return matches;
}

function splitDeletable(messages) {
  const now = Date.now();
  const deletable = [];
  let tooOldCount = 0;

  for (const message of messages) {
    if (now - message.createdTimestamp >= FOURTEEN_DAYS_MS) {
      tooOldCount += 1;
      continue;
    }
    deletable.push(message.id);
  }

  return { deletable, tooOldCount };
}

async function handleCleanCommand(interaction) {
  const amount = interaction.options.getInteger("nombre", true);
  const mode = interaction.options.getString("cible", true);

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Commande réservée aux serveurs.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: "Permission requise : ManageMessages.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.channel || !interaction.channel.isTextBased()) {
    await interaction.reply({
      content: "Salon invalide.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (typeof interaction.channel.bulkDelete !== "function") {
    await interaction.reply({
      content: "Ce type de salon ne permet pas la suppression en masse.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasBotPermissions(interaction)) {
    await interaction.reply({
      content:
        "Permissions bot manquantes: ViewChannel, ReadMessageHistory, ManageMessages.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const candidates = await collectCandidateMessages(
      interaction.channel,
      mode,
      amount
    );

    if (!candidates.length) {
      await interaction.editReply({
        content:
          mode === MODE_BOT
            ? "Aucun message de bot trouvé à supprimer."
            : "Aucun message trouvé à supprimer.",
      });
      return;
    }

    const { deletable, tooOldCount } = splitDeletable(candidates);
    if (!deletable.length) {
      await interaction.editReply({
        content:
          "Aucun message supprimable (les messages trouvés ont plus de 14 jours).",
      });
      return;
    }

    const deleted = await interaction.channel.bulkDelete(deletable, true);
    const deletedCount = deleted?.size || 0;

    const modeLabel =
      mode === MODE_BOT ? "messages du bot" : "messages (tous auteurs)";
    const missingCount = Math.max(0, amount - candidates.length);
    const lines = [
      `Suppression terminée : ${deletedCount} ${modeLabel} supprimé(s).`,
    ];

    if (tooOldCount > 0) {
      lines.push(`${tooOldCount} ignoré(s) : plus de 14 jours.`);
    }
    if (missingCount > 0) {
      lines.push(`${missingCount} non trouvé(s) dans l'historique récent.`);
    }

    await interaction.editReply({ content: lines.join("\n") });
  } catch (error) {
    console.error("[AUTOMOD] /clean failed");
    console.error(error);
    await interaction.editReply({
      content: "Erreur pendant la suppression. Réessaie dans un instant.",
    });
  }
}

async function registerCommand(client) {
  const command = new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Supprime des messages récents")
    .addStringOption((option) =>
      option
        .setName("cible")
        .setDescription("Choix des messages à supprimer")
        .setRequired(true)
        .addChoices(
          { name: "Tous les messages", value: MODE_ALL },
          { name: "Messages du bot", value: MODE_BOT }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("nombre")
        .setDescription(`Nombre de messages (1 à ${MAX_DELETE})`)
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_DELETE)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

  await upsertGuildCommand({
    client,
    commandName: COMMAND_NAME,
    commandJson: command.toJSON(),
    logPrefix: "AUTOMOD",
    missingGuildLog: "DISCORD_GUILD_ID absent, /clean non enregistré.",
  });
}

module.exports = {
  name: "feature:clean-command",
  async init(client) {
    client.once("clientReady", async () => {
      await registerCommand(client);
    });

    client.on("interactionCreate", async (interaction) => {
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === COMMAND_NAME
      ) {
        await handleCleanCommand(interaction);
      }
    });
  },
};
