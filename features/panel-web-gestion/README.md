# Panel Web Gestion (MVP)

Ce dossier contient l'interface web Next.js pour piloter les features du bot.

## Feature implémentée

- `roles-reaction` (lecture/sauvegarde PostgreSQL + publication Redis)

## Variables d'environnement

Voir `.env.example`.

- `PANEL_DATABASE_URL`
- `PANEL_REDIS_URL`
- `PANEL_REDIS_CHANNEL` (optionnel)
- `PANEL_DEFAULT_GUILD_ID`

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
