import { redirect } from "next/navigation";
import { getSessionFromCookieStore } from "@/lib/auth";

type Props = {
  searchParams?: Record<string, string | string[] | undefined>;
};

const ERROR_MESSAGES: Record<string, string> = {
  oauth_config: "Configuration OAuth Discord incomplète.",
  oauth_state: "Session OAuth invalide, merci de réessayer.",
  oauth_token: "Impossible de récupérer le token Discord.",
  oauth_discord: "Connexion Discord impossible pour le moment.",
  guild_missing: "Guild de vérification non configurée.",
  role_required: "Accès refusé: ce compte n'a pas le rôle requis.",
};

function getErrorMessage(searchParams?: Record<string, string | string[] | undefined>): string | null {
  const raw = searchParams?.error;
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || typeof key !== "string") {
    return null;
  }
  return ERROR_MESSAGES[key] || "Connexion refusée.";
}

export default function LoginPage({ searchParams }: Props) {
  const session = getSessionFromCookieStore();
  if (session) {
    redirect("/");
  }

  const error = getErrorMessage(searchParams);

  return (
    <main className="login-layout">
      <section className="login-card">
        <h1>Revenge Panel</h1>
        <p>Connexion Discord obligatoire pour accéder au panel.</p>
        {error ? <p className="error">{error}</p> : null}
        <a className="login-button" href="/api/auth/login">
          Se connecter avec Discord
        </a>
      </section>
    </main>
  );
}
