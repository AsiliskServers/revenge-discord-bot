# Panel Web Gestion (MVP)

Ce dossier contient l'interface web Next.js pour piloter les features du bot.

## Feature implémentée

- `roles-reaction` (lecture/sauvegarde PostgreSQL + publication Redis)

## Authentification

Connexion Discord OAuth2 obligatoire.

- Seuls les comptes ayant le rôle Discord `PANEL_ALLOWED_ROLE_ID` peuvent se connecter.
- Vérification sur la guild `PANEL_OAUTH_GUILD_ID` (ou `PANEL_DEFAULT_GUILD_ID`).
- Session signée via cookie HTTP-only.

## Variables d'environnement

Voir `.env.example`.

- `PANEL_DATABASE_URL`
- `PANEL_REDIS_URL`
- `PANEL_REDIS_CHANNEL` (optionnel)
- `PANEL_DEFAULT_GUILD_ID`
- `PANEL_OAUTH_GUILD_ID`
- `PANEL_ALLOWED_ROLE_ID`
- `PANEL_SESSION_SECRET`
- `PANEL_PUBLIC_BASE_URL`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `DISCORD_BOT_TOKEN` (requis pour lister rôles/salons dans le panel)

## Lancement local

```bash
cd features/panel-web-gestion
npm install
cp .env.example .env
npm run dev
```

Panel dispo sur `http://localhost:3010`.

## Build production

```bash
cd features/panel-web-gestion
npm install
npm run build
npm run start
```

## Base de données

Le schéma minimal est dans `db/schema.sql`.

```bash
psql "$PANEL_DATABASE_URL" -f db/schema.sql
```
