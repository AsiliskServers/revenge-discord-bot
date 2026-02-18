const { resolveManageableRole } = require("../_shared/common");

const AUTO_ROLE_ID = "997493288124813423";

module.exports = {
  name: "feature:auto-role-on-join",
  async init(client) {
    client.on("guildMemberAdd", async (member) => {
      try {
        if (client.config?.guildId && member.guild.id !== client.config.guildId) {
          return;
        }

        const resolvedRole = await resolveManageableRole(member.guild, AUTO_ROLE_ID);
        if (!resolvedRole.ok) {
          switch (resolvedRole.code) {
            case "ROLE_NOT_FOUND":
              console.error(
                `[AUTO_ROLE] Rôle introuvable (${AUTO_ROLE_ID}) sur ${member.guild.name}`
              );
              break;
            case "BOT_MEMBER_NOT_FOUND":
              console.error(
                `[AUTO_ROLE] Impossible de récupérer le membre bot sur ${member.guild.name}`
              );
              break;
            case "MISSING_MANAGE_ROLES":
              console.error(
                `[AUTO_ROLE] Permission manquante: ManageRoles sur ${member.guild.name}`
              );
              break;
            default:
              console.error(
                `[AUTO_ROLE] Le rôle du bot doit être au-dessus du rôle cible (${resolvedRole.role?.name || AUTO_ROLE_ID})`
              );
          }
          return;
        }

        await member.roles.add(resolvedRole.role, "Rôle automatique à l'arrivée");
        console.log(
          `[AUTO_ROLE] Rôle ${resolvedRole.role.name} ajouté à ${member.user.tag} (${member.id})`
        );
      } catch (error) {
        console.error(`[AUTO_ROLE] Échec pour ${member.user?.tag || member.id} (${member.id})`);
        console.error(error);
      }
    });
  },
};
