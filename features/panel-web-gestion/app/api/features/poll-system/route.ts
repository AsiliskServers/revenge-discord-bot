import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { fetchGuildMeta } from "@/lib/discord-guild";
import { publishFeatureUpdate } from "@/lib/redis";
import {
  getPollSystemRecord,
  normalizePollSystemConfig,
  savePollSystemRecord,
} from "@/lib/store";

type AuthorizedContext = {
  guildId: string;
  userId: string;
};

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

function resolveAuthorizedContext(
  request: NextRequest,
  bodyGuildId?: unknown
): AuthorizedContext | NextResponse {
  const session = getSessionFromRequest(request);
  if (!session) {
    return unauthorized();
  }

  const guildId = resolveGuildId(request, bodyGuildId);
  if (!guildId) {
    return NextResponse.json({ ok: false, error: "Guild ID manquant" }, { status: 400 });
  }
  if (guildId !== session.guildId) {
    return forbidden();
  }

  return { guildId, userId: session.userId };
}

export async function GET(request: NextRequest) {
  try {
    const context = resolveAuthorizedContext(request);
    if (context instanceof NextResponse) {
      return context;
    }

    const [record, meta] = await Promise.all([
      getPollSystemRecord(context.guildId),
      fetchGuildMeta(context.guildId),
    ]);

    return NextResponse.json({ ok: true, data: record, meta });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Impossible de charger la config", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const context = resolveAuthorizedContext(request, body?.guildId);
    if (context instanceof NextResponse) {
      return context;
    }

    const enabled = typeof body?.enabled === "boolean" ? body.enabled : true;
    const config = normalizePollSystemConfig(body?.config);

    const saved = await savePollSystemRecord({
      guildId: context.guildId,
      enabled,
      config,
      updatedBy: `panel:${context.userId}`,
    });

    await publishFeatureUpdate({
      type: "feature.updated",
      guildId: context.guildId,
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
