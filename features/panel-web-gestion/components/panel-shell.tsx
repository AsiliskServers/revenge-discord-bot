import SidebarNav, { type PanelSection } from "@/components/sidebar-nav";

type Props = {
  active: PanelSection;
  username: string;
  userId: string;
  children: React.ReactNode;
};

export default function PanelShell({ active, username, userId, children }: Props) {
  return (
    <main className="layout">
      <aside className="sidebar">
        <h1>Revenge Panel</h1>
        <p>panel-revenge.asilisk.fr</p>
        <SidebarNav active={active} userId={userId} />
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
