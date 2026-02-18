const path = require("node:path");
const crypto = require("node:crypto");
const { createCanvas } = require("@napi-rs/canvas");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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

const RULES_CHANNEL_ID = "1379051949730562121";
const VERIFIED_ROLE_ID = "998302154441891960";

const ACCEPT_BUTTON_ID = "rules_accept";
const SOLVE_BUTTON_PREFIX = "rules_solve:";
const MODAL_PREFIX = "rules_modal:";
const CAPTCHA_INPUT_ID = "captcha_input";

const CAPTCHA_LENGTH = 6;
const CAPTCHA_TTL_MS = 10 * 60 * 1000;

const RUNTIME_DIR = path.join(__dirname, ".runtime");
const MESSAGE_STATE_FILE = path.join(RUNTIME_DIR, "reglement-message.json");

const captchaSessions = new Map();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFrom(list) {
  return list[randomInt(0, list.length - 1)];
}

function generateCaptchaCode(length = CAPTCHA_LENGTH) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += alphabet[randomInt(0, alphabet.length - 1)];
  }
  return code;
}

function generateCaptchaPng(code) {
  const width = 360;
  const height = 130;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f8fafc");
  gradient.addColorStop(1, "#e2e8f0");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 14; i += 1) {
    const x1 = randomInt(0, width);
    const y1 = randomInt(0, height);
    const x2 = randomInt(0, width);
    const y2 = randomInt(0, height);
    const opacity = Math.random() * 0.45 + 0.2;
    ctx.strokeStyle = `rgba(107, 114, 128, ${opacity})`;
    ctx.lineWidth = randomInt(1, 2);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  for (let i = 0; i < 45; i += 1) {
    const cx = randomInt(0, width);
    const cy = randomInt(0, height);
    const r = randomInt(1, 2);
    const opacity = Math.random() * 0.35 + 0.2;
    ctx.fillStyle = `rgba(156, 163, 175, ${opacity})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const [index, char] of code.split("").entries()) {
    const x = 32 + index * 52 + randomInt(-4, 4);
    const y = 82 + randomInt(-8, 8);
    const rotate = (randomInt(-24, 24) * Math.PI) / 180;
    const skew = randomInt(-16, 16) * 0.01;
    const size = randomInt(44, 56);

    ctx.save();
    ctx.translate(x, y);
    ctx.transform(1, 0, skew, 1, 0, 0);
    ctx.rotate(rotate);
    ctx.fillStyle = randomFrom(["#111827", "#0f172a", "#1f2937", "#111111"]);
    ctx.font = `700 ${size}px Arial`;
    ctx.fillText(char, 0, 0);
    ctx.restore();
  }

  return canvas.toBuffer("image/png");
}

function buildRulesEmbed() {
  return new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("📝  RÈGLEMENT DU DISCORD")
    .setDescription(
      "Ce règlement est à lire attentivement si vous souhaitez éviter tout problème au sein du Discord. Certains comportements vous vaudront automatiquement l'éjection, voire le bannissement temporaire ou définitif.\n\n" +
        "🗺️・ SERVEUR DISCORD EN GÉNÉRAL\n" +
        "Les pseudonymes inappropriés, incarner des personnages fictifs, jouer avec les sentiments des gens, ainsi que l'usurpation d'identité sont strictement interdits.\n\n" +
        "Ce Discord n'est pas l'endroit pour régler vos conflits interpersonnels. Par conséquent, si la discussion dégénère en querelle, vous serez invité à poursuivre en privé votre discussion. Si vous persistez dans vos actions, vous serez sanctionné.\n\n" +
        "Tous les membres de la Revenge travaillent bénévolement pour maintenir un climat agréable et appliquer les règles sur les canaux. Que vous soyez ou non d'accord, vous n'avez aucun droit de vous en prendre à eux. Dans le cas contraire, ils seront en droit de vous appliquer toute sanction nécessaire.\n\n" +
        "Nous conseillons à notre communauté de laisser leurs opinions politiques et leurs appartenances religieuses à la porte de ce Discord.\n\n" +
        "N'oubliez pas le respect et la politesse.\n\n" +
        "✏️・ SALONS TEXTUELS\n" +
        "Tout spam abusif, troll, provocations, flood et diffusion d'informations privées/personnelles sont interdits.\n\n" +
        "La publicité sera seulement autorisée dans un salon dédié.\n\n" +
        "🔊・ SALONS VOCAUX\n" +
        "Le spam micro, les trolls et les modificateurs de voix sont strictement interdits.\n\n" +
        "Être présent sous différents pseudos sans raison valable est strictement interdit."
    );
}

function buildAcceptRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ACCEPT_BUTTON_ID)
      .setEmoji("✅")
      .setLabel("Accepter")
      .setStyle(ButtonStyle.Success)
  );
}

function buildRulesPayload() {
  return {
    embeds: [buildRulesEmbed()],
    components: [buildAcceptRow()],
    allowedMentions: { parse: [] },
  };
}

function readMessageState() {
  return readJsonFile(MESSAGE_STATE_FILE, null);
}

function writeMessageState(state) {
  writeJsonFile(MESSAGE_STATE_FILE, state);
}

function createCaptchaSession(userId, guildId) {
  const token = crypto.randomBytes(10).toString("hex");
  const session = {
    token,
    code: generateCaptchaCode(),
    userId,
    guildId,
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  };
  captchaSessions.set(token, session);
  return session;
}

function getCaptchaSession(token) {
  const session = captchaSessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    captchaSessions.delete(token);
    return null;
  }

  return session;
}

function cleanupExpiredCaptchaSessions() {
  const now = Date.now();
  for (const [token, session] of captchaSessions.entries()) {
    if (session.expiresAt <= now) {
      captchaSessions.delete(token);
    }
  }
}

async function findExistingRulesMessage(channel, botId) {
  return findBotMessageByComponent(channel, botId, {
    exactId: ACCEPT_BUTTON_ID,
    limit: 50,
  });
}

async function ensureRulesMessage(client) {
  if (!hasConfiguredGuildId(client)) {
    console.warn("[RULES] DISCORD_GUILD_ID absent, feature ignorée.");
    return;
  }

  const guild = await fetchConfiguredGuild(client);
  if (!guild) {
    console.error("[RULES] Serveur introuvable.");
    return;
  }

  const channel = await fetchGuildTextChannel(guild, RULES_CHANNEL_ID);
  if (!channel) {
    console.error(`[RULES] Salon règlement invalide (${RULES_CHANNEL_ID}).`);
    return;
  }

  const payload = buildRulesPayload();
  const state = readMessageState();

  if (
    state &&
    state.guildId === guild.id &&
    state.channelId === channel.id &&
    state.messageId
  ) {
    const existing = await channel.messages.fetch(state.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => null);
      return;
    }
  }

  const found = await findExistingRulesMessage(channel, client.user.id);
  if (found) {
    await found.edit(payload).catch(() => null);
    writeMessageState({ guildId: guild.id, channelId: channel.id, messageId: found.id });
    return;
  }

  const sent = await channel.send(payload);
  writeMessageState({ guildId: guild.id, channelId: channel.id, messageId: sent.id });
}

async function assignVerifiedRole(member) {
  if (member.roles.cache.has(VERIFIED_ROLE_ID)) {
    return { ok: true, already: true };
  }

  const resolvedRole = await resolveManageableRole(member.guild, VERIFIED_ROLE_ID);
  if (!resolvedRole.ok) {
    switch (resolvedRole.code) {
      case "ROLE_NOT_FOUND":
        return { ok: false, reason: "Rôle de vérification introuvable." };
      case "BOT_MEMBER_NOT_FOUND":
        return { ok: false, reason: "Membre bot introuvable." };
      case "MISSING_MANAGE_ROLES":
        return { ok: false, reason: "Permission manquante: ManageRoles." };
      default:
        return {
          ok: false,
          reason: "Le rôle du bot doit être au-dessus du rôle de vérification.",
        };
    }
  }

  await member.roles.add(resolvedRole.role, "Vérification règlement captcha");
  return { ok: true, already: false };
}

async function handleAcceptButton(interaction, client) {
  if (interaction.guildId !== client.config?.guildId) {
    await replyEphemeral(interaction, "Interaction non autorisée sur ce serveur.");
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await replyEphemeral(interaction, "Impossible de récupérer ton profil serveur.");
    return;
  }

  if (member.roles.cache.has(VERIFIED_ROLE_ID)) {
    await replyEphemeral(interaction, "Tu es déjà vérifié.");
    return;
  }

  const session = createCaptchaSession(interaction.user.id, interaction.guildId);
  const fileName = `captcha-${session.token}.png`;

  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("Vérification Captcha")
    .setDescription(
      "Lis les caractères de l'image, puis clique sur `Résoudre`.\n\n" +
        "Ce formulaire sera transmis à Revenge. Ne donne pas de mot de passe ni toute autre information sensible."
    )
    .setImage(`attachment://${fileName}`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SOLVE_BUTTON_PREFIX}${session.token}`)
      .setEmoji("✏️")
      .setLabel("Résoudre")
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    files: [new AttachmentBuilder(generateCaptchaPng(session.code), { name: fileName })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSolveButton(interaction) {
  const token = interaction.customId.slice(SOLVE_BUTTON_PREFIX.length);
  const session = getCaptchaSession(token);

  if (!session) {
    await replyEphemeral(interaction, "Captcha expiré. Clique à nouveau sur ACCEPTER.");
    return;
  }

  if (session.userId !== interaction.user.id) {
    await replyEphemeral(interaction, "Ce captcha ne t'appartient pas.");
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${token}`)
    .setTitle("Résolution Captcha")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(CAPTCHA_INPUT_ID)
          .setLabel("Réécris les caractères ci-dessous")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(4)
          .setMaxLength(12)
          .setPlaceholder(
            "Formulaire transmis à Revenge. Ne donne pas d'infos sensibles."
          )
      )
    );

  await interaction.showModal(modal);
}

async function handleCaptchaModal(interaction) {
  const token = interaction.customId.slice(MODAL_PREFIX.length);
  const session = getCaptchaSession(token);

  if (!session) {
    await replyEphemeral(interaction, "Captcha expiré. Clique à nouveau sur ACCEPTER.");
    return;
  }

  if (session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
    await replyEphemeral(interaction, "Ce captcha ne t'appartient pas.");
    return;
  }

  const value = interaction.fields.getTextInputValue(CAPTCHA_INPUT_ID).trim().toUpperCase();
  if (value !== session.code) {
    captchaSessions.delete(token);
    await replyEphemeral(interaction, "Captcha invalide. Reclique sur ACCEPTER pour recommencer.");
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  captchaSessions.delete(token);

  if (!member) {
    await replyEphemeral(interaction, "Impossible de récupérer ton profil serveur.");
    return;
  }

  try {
    const result = await assignVerifiedRole(member);
    if (!result.ok) {
      await replyEphemeral(interaction, `Vérification échouée : ${result.reason}`);
      return;
    }

    await replyEphemeral(
      interaction,
      result.already
        ? "Tu es déjà vérifié."
        : "Vérification validée. Tu as maintenant accès au serveur."
    );
  } catch (error) {
    console.error("[RULES] Attribution rôle vérification impossible");
    console.error(error);
    await replyEphemeral(interaction, "Une erreur est survenue. Réessaie dans un instant.");
  }
}

module.exports = {
  name: "feature:reglement-verification",
  async init(client) {
    client.once("clientReady", async () => {
      await ensureRulesMessage(client);
    });

    const timer = setInterval(cleanupExpiredCaptchaSessions, 60_000);
    if (typeof timer.unref === "function") {
      timer.unref();
    }

    client.on("interactionCreate", async (interaction) => {
      if (interaction.isButton()) {
        if (interaction.customId === ACCEPT_BUTTON_ID) {
          await handleAcceptButton(interaction, client);
          return;
        }

        if (interaction.customId.startsWith(SOLVE_BUTTON_PREFIX)) {
          await handleSolveButton(interaction);
        }

        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_PREFIX)) {
        await handleCaptchaModal(interaction);
      }
    });
  },
};
