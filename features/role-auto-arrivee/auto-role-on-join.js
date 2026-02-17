const { PermissionFlagsBits } = require("discord.js");

const AUTO_ROLE_ID = "997493288124813423";

module.exports = {
  name: "feature:auto-role-on-join",
  async init(client) {
    client.on("guildMemberAdd", async (member) => {
      try {
        if (client.config?.guildId && member.guild.id !== client.config.guildId) {
          return;
        }

        const role =
          member.guild.roles.cache.get(AUTO_ROLE_ID) ||
          (await member.guild.roles.fetch(AUTO_ROLE_ID).catch(() => null));

        if (!role) {
          console.error(
            `[AUTO_ROLE] Rôle introuvable (${AUTO_ROLE_ID}) sur ${member.guild.name}`
          );
          return;
        }

        const botMember =
          member.guild.members.me ||
          (await member.guild.members.fetchMe().catch(() => null));

        if (!botMember) {
          console.error(`[AUTO_ROLE] Impossible de récupérer le membre bot sur ${member.guild.name}`);
          return;
        }

        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
          console.error(`[AUTO_ROLE] Permission manquante: ManageRoles sur ${member.guild.name}`);
          return;
        }

        if (botMember.roles.highest.comparePositionTo(role) <= 0) {
          console.error(
            `[AUTO_ROLE] Le rôle du bot doit être au-dessus du rôle cible (${role.name})`
          );
          return;
        }

        await member.roles.add(role, "Rôle automatique à l'arrivée");
        console.log(`[AUTO_ROLE] Rôle ${role.name} ajouté à ${member.user.tag} (${member.id})`);
      } catch (error) {
        console.error(`[AUTO_ROLE] Échec pour ${member.user?.tag || member.id} (${member.id})`);
        console.error(error);
      }
    });
  },
};
