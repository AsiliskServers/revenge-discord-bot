import PanelShell from "@/components/panel-shell";
import PollSystemCard from "@/components/poll-system-card";
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

export default function PollSystemPage() {
  const session = getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  return (
    <PanelShell active="poll-system" username={session.username}>
      <PollSystemCard guildId={resolveGuildId(session.guildId)} />
    </PanelShell>
  );
}
