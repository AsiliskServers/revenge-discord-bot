import RolesReactionCard from "@/components/roles-reaction-card";

export default function HomePage() {
  const guildId =
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
          <p>Version MVP branchée PostgreSQL + Redis pour le pilotage à chaud.</p>
        </header>

        <RolesReactionCard guildId={guildId} />
      </section>
    </main>
  );
}
