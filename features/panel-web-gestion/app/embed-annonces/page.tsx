import EmbedAnnouncementsCard from "@/components/embed-annonces-card";
import PanelShell from "@/components/panel-shell";
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

export default function EmbedAnnouncementsPage() {
  const session = getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  return (
    <PanelShell active="embed-annonces" username={session.username} userId={session.userId}>
      <EmbedAnnouncementsCard guildId={resolveGuildId(session.guildId)} />
    </PanelShell>
  );
}
