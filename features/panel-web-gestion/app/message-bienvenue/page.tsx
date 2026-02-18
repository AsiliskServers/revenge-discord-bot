import PanelShell from "@/components/panel-shell";
import WelcomeMessageCard from "@/components/welcome-message-card";
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

export default function WelcomeMessagePage() {
  const session = getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  return (
    <PanelShell active="welcome-message" username={session.username} userId={session.userId}>
      <WelcomeMessageCard guildId={resolveGuildId(session.guildId)} />
    </PanelShell>
  );
}
