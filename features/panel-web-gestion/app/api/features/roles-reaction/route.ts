import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { publishFeatureUpdate } from "@/lib/redis";
import {
  getRolesReactionRecord,
  normalizeRoleReactionConfig,
  saveRolesReactionRecord,
} from "@/lib/store";

function resolveGuildId(request: NextRequest, bodyGuildId?: unknown): string {
  const fromBody = typeof bodyGuildId === "string" ? bodyGuildId.trim() : "";
  if (fromBody) {
    return fromBody;
  }

  const fromQuery = request.nextUrl.searchParams.get("guildId")?.trim() || "";
  if (fromQuery) {
    return fromQuery;
  }

  const fromEnv = process.env.PANEL_DEFAULT_GUILD_ID || process.env.DISCORD_GUILD_ID || "";
  return fromEnv.trim();
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Non authentifie" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ ok: false, error: "Acces refuse" }, { status: 403 });
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return unauthorized();
    }

    const guildId = resolveGuildId(request);
    if (!guildId) {
      return NextResponse.json({ ok: false, error: "Guild ID manquant" }, { status: 400 });
    }
    if (guildId !== session.guildId) {
      return forbidden();
    }

    const record = await getRolesReactionRecord(guildId);
    return NextResponse.json({ ok: true, data: record });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Impossible de charger la config", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return unauthorized();
    }

    const body = await request.json().catch(() => ({}));
    const guildId = resolveGuildId(request, body?.guildId);
    if (!guildId) {
      return NextResponse.json({ ok: false, error: "Guild ID manquant" }, { status: 400 });
    }
    if (guildId !== session.guildId) {
      return forbidden();
    }

    const enabled = typeof body?.enabled === "boolean" ? body.enabled : true;
    const config = normalizeRoleReactionConfig(body?.config);

    const saved = await saveRolesReactionRecord({
      guildId,
      enabled,
      config,
      updatedBy: `panel:${session.userId}`,
    });

    await publishFeatureUpdate({
      type: "feature.updated",
      guildId,
      featureKey: saved.featureKey,
      enabled: saved.enabled,
      config: saved.config,
      updatedAt: saved.updatedAt,
    });

    return NextResponse.json({ ok: true, data: saved });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Impossible de sauvegarder la config", details: String(error) },
      { status: 500 }
    );
  }
}
