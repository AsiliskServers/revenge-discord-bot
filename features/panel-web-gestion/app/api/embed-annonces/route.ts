import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { fetchGuildMeta } from "@/lib/discord-guild";

type AuthorizedContext = {
  guildId: string;
  userId: string;
};

type EmbedDraft = {
  authorName?: string;
  authorUrl?: string;
  authorIconUrl?: string;
  title?: string;
  description?: string;
  url?: string;
  color?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  footerText?: string;
  footerIconUrl?: string;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function getBotToken(): string {
  const token = (process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN manquant");
  }
  return token;
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Non authentifie" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ ok: false, error: "Acces refuse" }, { status: 403 });
}

function resolveGuildId(request: NextRequest, bodyGuildId?: unknown): string {
  const fromBody = asString(bodyGuildId);
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

function parseColorHexToInt(input: string): number | null {
  const hex = input.replace(/^#/, "").trim();
  if (!hex) {
    return null;
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }
  return Number.parseInt(hex, 16);
}

function toSafeUrl(input: string): string | undefined {
  const value = input.trim();
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function buildDiscordEmbed(draft: EmbedDraft): Record<string, unknown> | null {
  const authorName = asString(draft.authorName).slice(0, 256);
  const authorUrl = toSafeUrl(asString(draft.authorUrl));
  const authorIconUrl = toSafeUrl(asString(draft.authorIconUrl));

  const title = asString(draft.title).slice(0, 256);
  const description = asString(draft.description).slice(0, 4096);
  const url = toSafeUrl(asString(draft.url));
  const color = parseColorHexToInt(asString(draft.color));
  const imageUrl = toSafeUrl(asString(draft.imageUrl));
  const thumbnailUrl = toSafeUrl(asString(draft.thumbnailUrl));

  const footerText = asString(draft.footerText).slice(0, 2048);
  const footerIconUrl = toSafeUrl(asString(draft.footerIconUrl));

  const embed: Record<string, unknown> = {};

  if (authorName) {
    const author: Record<string, unknown> = { name: authorName };
    if (authorUrl) {
      author.url = authorUrl;
    }
    if (authorIconUrl) {
      author.icon_url = authorIconUrl;
    }
    embed.author = author;
  }

  if (title) {
    embed.title = title;
  }
  if (description) {
    embed.description = description;
  }
  if (url) {
    embed.url = url;
  }
  if (typeof color === "number") {
    embed.color = color;
  }
  if (imageUrl) {
    embed.image = { url: imageUrl };
  }
  if (thumbnailUrl) {
    embed.thumbnail = { url: thumbnailUrl };
  }

  if (footerText) {
    const footer: Record<string, unknown> = { text: footerText };
    if (footerIconUrl) {
      footer.icon_url = footerIconUrl;
    }
    embed.footer = footer;
  }

  const hasAnyField = Object.keys(embed).length > 0;
  if (!hasAnyField) {
    return null;
  }

  const hasStructuralField =
    Boolean(embed.title) ||
    Boolean(embed.author) ||
    Boolean(embed.footer) ||
    Boolean(embed.image) ||
    Boolean(embed.thumbnail) ||
    Boolean(embed.url);

  if (!embed.description && !hasStructuralField) {
    throw new Error("Description is required when no other fields are set");
  }

  return embed;
}

async function fetchDiscordChannel(channelId: string): Promise<{ guild_id?: string } | null> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    headers: {
      Authorization: `Bot ${getBotToken()}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as { guild_id?: string };
}

export async function GET(request: NextRequest) {
  try {
    const context = resolveAuthorizedContext(request);
    if (context instanceof NextResponse) {
      return context;
    }

    const meta = await fetchGuildMeta(context.guildId);
    return NextResponse.json({ ok: true, data: { guildId: context.guildId }, meta });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Impossible de charger les metadonnees", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    let guildId = "";
    let channelId = "";
    let content = "";
    let attachmentUrls: string[] = [];
    let embedDraft: EmbedDraft = {};
    let uploadedFiles: File[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();

      guildId = asString(form.get("guildId"));
      channelId = asString(form.get("channelId"));
      content = asString(form.get("content"));

      const rawAttachmentUrls = asString(form.get("attachmentUrls"), "[]");
      const rawEmbed = asString(form.get("embed"), "{}");

      attachmentUrls = JSON.parse(rawAttachmentUrls);
      embedDraft = JSON.parse(rawEmbed);

      uploadedFiles = form
        .getAll("files")
        .filter((entry): entry is File => typeof File !== "undefined" && entry instanceof File);
    } else {
      const body = await request.json().catch(() => ({}));
      guildId = asString(body.guildId);
      channelId = asString(body.channelId);
      content = asString(body.content);
      attachmentUrls = Array.isArray(body.attachmentUrls)
        ? body.attachmentUrls.map((item: unknown) => asString(item)).filter(Boolean)
        : [];
      embedDraft = (body.embed || {}) as EmbedDraft;
    }

    const context = resolveAuthorizedContext(request, guildId);
    if (context instanceof NextResponse) {
      return context;
    }

    if (!channelId) {
      return NextResponse.json({ ok: false, error: "Salon cible manquant" }, { status: 400 });
    }

    const channel = await fetchDiscordChannel(channelId);
    if (!channel || channel.guild_id !== context.guildId) {
      return NextResponse.json({ ok: false, error: "Salon invalide pour ce serveur" }, { status: 400 });
    }

    const safeAttachmentUrls = attachmentUrls
      .map((item) => toSafeUrl(item) || "")
      .filter(Boolean)
      .slice(0, 10);

    const embed = buildDiscordEmbed(embedDraft);

    const fullContentParts = [content.trim(), ...safeAttachmentUrls].filter(Boolean);
    const fullContent = fullContentParts.join("\n").slice(0, 2000);

    if (!fullContent && !embed && uploadedFiles.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Message vide: ajoutez du content, un embed ou un fichier" },
        { status: 400 }
      );
    }

    const payload: Record<string, unknown> = {
      allowed_mentions: { parse: [] },
    };

    if (fullContent) {
      payload.content = fullContent;
    }

    if (embed) {
      payload.embeds = [embed];
    }

    const endpoint = `https://discord.com/api/v10/channels/${channelId}/messages`;

    let response: Response;
    if (uploadedFiles.length > 0) {
      const form = new FormData();
      form.append("payload_json", JSON.stringify(payload));

      uploadedFiles.slice(0, 10).forEach((file, index) => {
        form.append(`files[${index}]`, file, file.name || `file-${index}`);
      });

      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bot ${getBotToken()}`,
        },
        body: form,
      });
    } else {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bot ${getBotToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }

    const raw = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Echec envoi Discord",
          details: raw || `HTTP ${response.status}`,
        },
        { status: 400 }
      );
    }

    let data: { id?: string } = {};
    try {
      data = JSON.parse(raw) as { id?: string };
    } catch {
      data = {};
    }

    return NextResponse.json({ ok: true, data: { messageId: data.id || null } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Impossible d'envoyer l'annonce", details: String(error) },
      { status: 500 }
    );
  }
}
