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
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  fetchConfiguredGuild,
  fetchGuildTextChannel,
  hasConfiguredGuildId,
  readJsonFile,
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
    .setTitle("📝  REGLEMENT DU DISCORD")
    .setDescription(
      "Ce reglement est a lire attentivement si vous souhaitez eviter tout probleme au sein du Discord. Certains comportements vous vaudront automatiquement l'ejection, voire le bannissement temporaire ou definitif.\n\n" +
        "🗺️・ SERVEUR DISCORD EN GENERAL\n" +
        "Les pseudonymes inappropries, incarner des personnages fictifs, jouer avec les sentiments des gens, ainsi que l'usurpation d'identite sont strictement interdits.\n\n" +
        "Ce Discord n'est pas l'endroit pour regler vos conflits interpersonnels. Par consequent, si la discussion degenere en querelle, vous serez invite a poursuivre en prive votre discussion. Si vous persistez dans vos actions, vous serez sanctionne.\n\n" +
        "Tous les membres de la Revenge travaillent benevolement pour maintenir un climat agreable et appliquer les regles sur les canaux. Que vous soyez ou non d'accord, vous n'avez aucun droit de vous en prendre a eux. Dans le cas contraire, ils seront en droit de vous appliquer toute sanction necessaire.\n\n" +
        "Nous conseillons a notre communaute de laisser leurs opinions politiques et leurs appartenances religieuses a la porte de ce Discord.\n\n" +
        "N'oubliez pas le respect et la politesse.\n\n" +
        "✏️・ SALONS TEXTUELS\n" +
        "Tout spam abusif, troll, provocations, flood et diffusion d'informations privees/personnelles sont interdits.\n\n" +
        "La publicite sera seulement autorisee dans un salon dedie.\n\n" +
        "🔊・ SALONS VOCAUX\n" +
        "Le spam micro, les trolls et les modificateurs de voix sont strictement interdits.\n\n" +
        "Etre present sous differents pseudos sans raison valable est strictement interdit."
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
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) {
    return null;
  }

  return (
    messages.find((message) => {
      if (message.author?.id !== botId) {
        return false;
      }

      return message.components.some((row) =>
        row.components.some((component) => component.customId === ACCEPT_BUTTON_ID)
      );
    }) || null
  );
}

async function ensureRulesMessage(client) {
  if (!hasConfiguredGuildId(client)) {
    console.warn("[RULES] DISCORD_GUILD_ID absent, feature ignoree.");
    return;
  }

  const guild = await fetchConfiguredGuild(client);
  if (!guild) {
    console.error("[RULES] Serveur introuvable.");
    return;
  }

  const channel = await fetchGuildTextChannel(guild, RULES_CHANNEL_ID);
  if (!channel) {
    console.error(`[RULES] Salon reglement invalide (${RULES_CHANNEL_ID}).`);
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

  const role =
    member.guild.roles.cache.get(VERIFIED_ROLE_ID) ||
    (await member.guild.roles.fetch(VERIFIED_ROLE_ID).catch(() => null));

  if (!role) {
    return { ok: false, reason: "Role de verification introuvable." };
  }

  const botMember =
    member.guild.members.me || (await member.guild.members.fetchMe().catch(() => null));

  if (!botMember) {
    return { ok: false, reason: "Membre bot introuvable." };
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: "Permission manquante: ManageRoles." };
  }

  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    return {
      ok: false,
      reason: "Le role du bot doit etre au-dessus du role de verification.",
    };
  }

  await member.roles.add(role, "Verification reglement captcha");
  return { ok: true, already: false };
}

async function handleAcceptButton(interaction, client) {
  if (interaction.guildId !== client.config?.guildId) {
    await interaction.reply({
      content: "Interaction non autorisee sur ce serveur.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({
      content: "Impossible de recuperer ton profil serveur.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (member.roles.cache.has(VERIFIED_ROLE_ID)) {
    await interaction.reply({
      content: "Tu es deja verifie.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session = createCaptchaSession(interaction.user.id, interaction.guildId);
  const fileName = `captcha-${session.token}.png`;

  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("Verification Captcha")
    .setDescription(
      "Lis les caracteres de l'image, puis clique sur `Résoudre`.\n\n" +
        "Ce formulaire sera transmis a Revenge. Ne donne pas de mot de passe ni toute autre information sensible."
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
    await interaction.reply({
      content: "Captcha expire. Clique a nouveau sur ACCEPTER.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.userId !== interaction.user.id) {
    await interaction.reply({
      content: "Ce captcha ne t'appartient pas.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${token}`)
    .setTitle("Resolution Captcha")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(CAPTCHA_INPUT_ID)
          .setLabel("Reecris les caracteres ci-dessous")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(4)
          .setMaxLength(12)
          .setPlaceholder(
            "Formulaire transmis a Revenge. Ne donne pas d'infos sensibles."
          )
      )
    );

  await interaction.showModal(modal);
}

async function handleCaptchaModal(interaction) {
  const token = interaction.customId.slice(MODAL_PREFIX.length);
  const session = getCaptchaSession(token);

  if (!session) {
    await interaction.reply({
      content: "Captcha expire. Clique a nouveau sur ACCEPTER.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
    await interaction.reply({
      content: "Ce captcha ne t'appartient pas.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const value = interaction.fields.getTextInputValue(CAPTCHA_INPUT_ID).trim().toUpperCase();
  if (value !== session.code) {
    captchaSessions.delete(token);
    await interaction.reply({
      content: "Captcha invalide. Reclique sur ACCEPTER pour recommencer.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  captchaSessions.delete(token);

  if (!member) {
    await interaction.reply({
      content: "Impossible de recuperer ton profil serveur.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const result = await assignVerifiedRole(member);
    if (!result.ok) {
      await interaction.reply({
        content: `Verification echouee: ${result.reason}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: result.already
        ? "Tu es deja verifie."
        : "Verification validee. Tu as maintenant acces au serveur.",
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error("[RULES] Attribution role verification impossible");
    console.error(error);
    await interaction.reply({
      content: "Une erreur est survenue. Reessaie dans un instant.",
      flags: MessageFlags.Ephemeral,
    });
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
