import Link from "next/link";

type PanelSection =
  | "roles-reaction"
  | "voice-creator"
  | "poll-system"
  | "welcome-message";

type Props = {
  active: PanelSection;
  username: string;
  children: React.ReactNode;
};

export default function PanelShell({ active, username, children }: Props) {
  return (
    <main className="layout">
      <aside className="sidebar">
        <h1>Revenge Panel</h1>
        <p>panel-revenge.asilisk.fr</p>
        <nav>
          <Link
            className={active === "roles-reaction" ? "active" : ""}
            href="/roles-reaction"
          >
            Roles reactions
          </Link>
          <Link
            className={active === "voice-creator" ? "active" : ""}
            href="/voice-creator"
          >
            Createur vocal
          </Link>
          <Link
            className={active === "poll-system" ? "active" : ""}
            href="/systeme-sondage"
          >
            Systeme sondage
          </Link>
          <Link
            className={active === "welcome-message" ? "active" : ""}
            href="/message-bienvenue"
          >
            Message bienvenue
          </Link>
        </nav>
      </aside>

      <section className="content">
        <header className="content-header">
          <h2>Gestion des fonctionnalites</h2>
          <p>Version MVP connectee a PostgreSQL et Redis pour le pilotage a chaud.</p>
          <div className="session-header">
            <span>{username}</span>
            <a href="/api/auth/logout">Deconnexion</a>
          </div>
        </header>

        {children}
      </section>
    </main>
  );
}
