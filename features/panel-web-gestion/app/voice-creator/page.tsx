import PanelShell from "@/components/panel-shell";
import VoiceCreatorCard from "@/components/voice-creator-card";
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

export default function VoiceCreatorPage() {
  const session = getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  return (
    <PanelShell active="voice-creator" username={session.username}>
      <VoiceCreatorCard guildId={resolveGuildId(session.guildId)} />
    </PanelShell>
  );
}
