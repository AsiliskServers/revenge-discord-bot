import PanelShell from "@/components/panel-shell";
import RolesReactionCard from "@/components/roles-reaction-card";
import { getSessionFromCookieStore } from "@/lib/auth";
import { redirect } from "next/navigation";

function resolveGuildId(sessionGuildId?: string) {
  return (
    sessionGuildId ||
    process.env.PANEL_DEFAULT_GUILD_ID ||
    process.env.DISCORD_GUILD_ID ||
    "996064567031513138"
  );
}

export default function RolesReactionPage() {
  const session = getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  return (
    <PanelShell active="roles-reaction" username={session.username}>
      <RolesReactionCard guildId={resolveGuildId(session.guildId)} />
    </PanelShell>
  );
}
