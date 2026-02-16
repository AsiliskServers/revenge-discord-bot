const fs = require("node:fs");
const path = require("node:path");
const { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { fetchGuildTextChannel } = require("../_shared/common");

const WELCOME_CHANNEL_ID = "996443449744167073";
const TITLE_TARGET_CHANNEL_ID = "1349631503730212965";
const WELCOME_THUMBNAIL_FILE = "image.png";

async function resolveTitleUrl(guild) {
  const channel =
    guild.channels.cache.get(TITLE_TARGET_CHANNEL_ID) ||
    (await guild.channels.fetch(TITLE_TARGET_CHANNEL_ID).catch(() => null));

  if (!channel) {
    return `https://discord.com/channels/${guild.id}/${TITLE_TARGET_CHANNEL_ID}`;
  }

  return channel.url;
}

function buildWelcomeEmbed({ member, titleUrl, botAvatarUrl }) {
  return new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle("REVENGE・DISCORD")
    .setURL(titleUrl)
    .setDescription(
      `Bienvenue a toi ${member} chez la REVENGE.\n\n` +
        `C'est un plaisir de t'accueillir, le discord compte desormais ${member.guild.memberCount} personnes ❗\n` +
        "Merci d'agrandir la Famille, installe toi et profite 🎉"
    )
    .setFooter({
      text: "REVENGE | Bienvenue",
      iconURL: botAvatarUrl || undefined,
    });
}

function canSendWelcome(botMember, channel) {
  const perms = channel.permissionsFor(botMember);
  return {
    canView: Boolean(perms?.has(PermissionFlagsBits.ViewChannel)),
    canSend: Boolean(perms?.has(PermissionFlagsBits.SendMessages)),
    canEmbed: Boolean(perms?.has(PermissionFlagsBits.EmbedLinks)),
    canAttach: Boolean(perms?.has(PermissionFlagsBits.AttachFiles)),
  };
}

module.exports = {
  name: "feature:welcome-embed-on-join",
  async init(client) {
    client.on("guildMemberAdd", async (member) => {
      try {
        if (client.config?.guildId && member.guild.id !== client.config.guildId) {
          return;
        }

        const welcomeChannel = await fetchGuildTextChannel(member.guild, WELCOME_CHANNEL_ID);
        if (!welcomeChannel) {
          console.error(
            `[WELCOME] Salon introuvable/invalide (${WELCOME_CHANNEL_ID}) sur ${member.guild.name}`
          );
          return;
        }

        const botMember =
          member.guild.members.me ||
          (await member.guild.members.fetchMe().catch(() => null));

        if (!botMember) {
          console.error(`[WELCOME] Impossible de recuperer le membre bot sur ${member.guild.name}`);
          return;
        }

        const perms = canSendWelcome(botMember, welcomeChannel);
        if (!perms.canView || !perms.canSend || !perms.canEmbed) {
          console.error(
            `[WELCOME] Permissions manquantes dans #${welcomeChannel.name}: ViewChannel/SendMessages/EmbedLinks`
          );
          return;
        }

        const titleUrl = await resolveTitleUrl(member.guild);
        const embed = buildWelcomeEmbed({
          member,
          titleUrl,
          botAvatarUrl: client.user?.displayAvatarURL(),
        });

        const files = [];
        const thumbnailPath = path.join(__dirname, WELCOME_THUMBNAIL_FILE);
        if (perms.canAttach && fs.existsSync(thumbnailPath)) {
          files.push(new AttachmentBuilder(thumbnailPath, { name: WELCOME_THUMBNAIL_FILE }));
          embed.setThumbnail(`attachment://${WELCOME_THUMBNAIL_FILE}`);
        }

        await welcomeChannel.send({
          embeds: [embed],
          files,
          allowedMentions: { users: [member.id] },
        });

        console.log(
          `[WELCOME] Message envoye pour ${member.user.tag} dans #${welcomeChannel.name}`
        );
      } catch (error) {
        console.error(`[WELCOME] Echec pour ${member.user?.tag || member.id} (${member.id})`);
        console.error(error);
      }
    });
  },
};
