import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const PANEL_SESSION_COOKIE = "revenge_panel_session";
export const OAUTH_STATE_COOKIE = "revenge_panel_oauth_state";
export const PANEL_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const OAUTH_STATE_TTL_SECONDS = 60 * 10;

export type PanelSession = {
  userId: string;
  username: string;
  avatar: string | null;
  guildId: string;
  roles: string[];
  issuedAt: number;
};

export type DiscordOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  guildId: string;
  allowedRoleId: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

function getSessionSecret(): string {
  const secret = requiredEnv("PANEL_SESSION_SECRET");
  if (secret.length < 32) {
    throw new Error("PANEL_SESSION_SECRET doit contenir au moins 32 caracteres");
  }
  return secret;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payloadBase64: string): string {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(payloadBase64)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function createSessionToken(session: PanelSession): string {
  const payloadBase64 = toBase64Url(JSON.stringify(session));
  const signature = sign(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function parseSession(raw: unknown): PanelSession | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<PanelSession>;
  if (
    typeof value.userId !== "string" ||
    typeof value.username !== "string" ||
    typeof value.guildId !== "string" ||
    !Array.isArray(value.roles) ||
    typeof value.issuedAt !== "number"
  ) {
    return null;
  }

  return {
    userId: value.userId,
    username: value.username,
    avatar: typeof value.avatar === "string" ? value.avatar : null,
    guildId: value.guildId,
    roles: value.roles.filter((item): item is string => typeof item === "string"),
    issuedAt: value.issuedAt,
  };
}

export function verifySessionToken(token: string | null | undefined): PanelSession | null {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadBase64, signature] = parts;
  const expected = sign(payloadBase64);
  if (!safeEqual(signature, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadBase64));
    const session = parseSession(payload);
    if (!session) {
      return null;
    }
    const age = Math.floor(Date.now() / 1000) - session.issuedAt;
    if (age < 0 || age > PANEL_SESSION_TTL_SECONDS) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: NextRequest): PanelSession | null {
  const token = request.cookies.get(PANEL_SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export function getSessionFromCookieStore(): PanelSession | null {
  const token = cookies().get(PANEL_SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export function createOAuthState(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function getDiscordOAuthConfig(): DiscordOAuthConfig {
  return {
    clientId: requiredEnv("DISCORD_CLIENT_ID"),
    clientSecret: requiredEnv("DISCORD_CLIENT_SECRET"),
    redirectUri: requiredEnv("DISCORD_REDIRECT_URI"),
    guildId: (
      process.env.PANEL_OAUTH_GUILD_ID ||
      process.env.PANEL_DEFAULT_GUILD_ID ||
      process.env.DISCORD_GUILD_ID ||
      ""
    ).trim(),
    allowedRoleId: (process.env.PANEL_ALLOWED_ROLE_ID || "1473478641886298156").trim(),
  };
}

export function buildDiscordAvatarUrl(
  userId: string,
  avatarHash: string | null | undefined
): string | null {
  if (!avatarHash) {
    return null;
  }
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png`;
}
