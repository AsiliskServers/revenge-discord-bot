import { NextRequest, NextResponse } from "next/server";
import {
  buildDiscordAvatarUrl,
  createSessionToken,
  getDiscordOAuthConfig,
  getPanelPublicOrigin,
  OAUTH_STATE_COOKIE,
  PANEL_SESSION_COOKIE,
  PANEL_SESSION_TTL_SECONDS,
  type PanelSession,
} from "@/lib/auth";

type DiscordTokenResponse = {
  access_token?: string;
};

type DiscordUserResponse = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

type DiscordMemberResponse = {
  roles?: string[];
};

function loginRedirect(request: NextRequest, error: string): NextResponse {
  const url = new URL("/login", getPanelPublicOrigin(request));
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

async function fetchDiscordJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Discord API error (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function GET(request: NextRequest) {
  const queryState = request.nextUrl.searchParams.get("state") || "";
  const code = request.nextUrl.searchParams.get("code") || "";
  const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value || "";

  if (!queryState || !code || !stateCookie || queryState !== stateCookie) {
    return loginRedirect(request, "oauth_state");
  }

  try {
    const { clientId, clientSecret, redirectUri, guildId, allowedRoleId } = getDiscordOAuthConfig();
    if (!guildId) {
      return loginRedirect(request, "guild_missing");
    }

    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody.toString(),
      cache: "no-store",
    });

    if (!tokenResponse.ok) {
      return loginRedirect(request, "oauth_token");
    }

    const tokenJson = (await tokenResponse.json()) as DiscordTokenResponse;
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      return loginRedirect(request, "oauth_token");
    }

    const [user, member] = await Promise.all([
      fetchDiscordJson<DiscordUserResponse>("https://discord.com/api/v10/users/@me", accessToken),
      fetchDiscordJson<DiscordMemberResponse>(
        `https://discord.com/api/v10/users/@me/guilds/${guildId}/member`,
        accessToken
      ),
    ]);

    const roles = Array.isArray(member.roles) ? member.roles : [];
    if (!roles.includes(allowedRoleId)) {
      return loginRedirect(request, "role_required");
    }

    const session: PanelSession = {
      userId: user.id,
      username: user.global_name?.trim() || user.username,
      avatar: buildDiscordAvatarUrl(user.id, user.avatar),
      guildId,
      roles,
      issuedAt: Math.floor(Date.now() / 1000),
    };

    const redirectUrl = new URL("/", getPanelPublicOrigin(request));
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(PANEL_SESSION_COOKIE, createSessionToken(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: PANEL_SESSION_TTL_SECONDS,
    });
    response.cookies.set(OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch {
    return loginRedirect(request, "oauth_discord");
  }
}
