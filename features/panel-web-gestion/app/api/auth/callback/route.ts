import { NextRequest, NextResponse } from "next/server";
import {
  buildDiscordAvatarUrl,
  buildPanelUrl,
  clearOAuthStateCookie,
  createSessionToken,
  getDiscordOAuthConfig,
  OAUTH_STATE_COOKIE,
  redirectToLogin,
  setPanelSessionCookie,
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
    return redirectToLogin(request, "oauth_state");
  }

  try {
    const { clientId, clientSecret, redirectUri, guildId, allowedRoleId } = getDiscordOAuthConfig();
    if (!guildId) {
      return redirectToLogin(request, "guild_missing");
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
      return redirectToLogin(request, "oauth_token");
    }

    const tokenJson = (await tokenResponse.json()) as DiscordTokenResponse;
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      return redirectToLogin(request, "oauth_token");
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
      return redirectToLogin(request, "role_required");
    }

    const session: PanelSession = {
      userId: user.id,
      username: user.global_name?.trim() || user.username,
      avatar: buildDiscordAvatarUrl(user.id, user.avatar),
      guildId,
      roles,
      issuedAt: Math.floor(Date.now() / 1000),
    };

    const redirectUrl = buildPanelUrl(request, "/");
    const response = NextResponse.redirect(redirectUrl);
    setPanelSessionCookie(response, createSessionToken(session));
    clearOAuthStateCookie(response);
    return response;
  } catch {
    return redirectToLogin(request, "oauth_discord");
  }
}
