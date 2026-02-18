import RolesReactionCard from "@/components/roles-reaction-card";
import { getSessionFromCookieStore } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function HomePage() {
  const session = getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  const guildId =
    session.guildId ||
    process.env.PANEL_DEFAULT_GUILD_ID ||
    process.env.DISCORD_GUILD_ID ||
    "996064567031513138";

  return (
    <main className="layout">
      <aside className="sidebar">
        <h1>Revenge Panel</h1>
        <p>panel-revenge.asilisk.fr</p>
        <nav>
          <a className="active" href="#roles-reaction">
            Roles Reaction
          </a>
        </nav>
      </aside>

      <section className="content" id="roles-reaction">
        <header className="content-header">
          <h2>Gestion des Features</h2>
          <p>Version MVP branchee PostgreSQL + Redis pour le pilotage a chaud.</p>
          <div className="session-header">
            <span>{session.username}</span>
            <a href="/api/auth/logout">Deconnexion</a>
          </div>
        </header>

        <RolesReactionCard guildId={guildId} />
      </section>
    </main>
  );
}
