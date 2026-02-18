import { NextRequest, NextResponse } from "next/server";
import {
  createOAuthState,
  getDiscordOAuthConfig,
  getPanelPublicOrigin,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
} from "@/lib/auth";

function buildLoginRedirect(request: NextRequest, error: string): NextResponse {
  const url = new URL("/login", getPanelPublicOrigin(request));
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  try {
    const { clientId, redirectUri } = getDiscordOAuthConfig();
    const state = createOAuthState();

    const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", "identify guilds.members.read");
    authorizeUrl.searchParams.set("state", state);

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: OAUTH_STATE_TTL_SECONDS,
    });
    return response;
  } catch {
    return buildLoginRedirect(request, "oauth_config");
  }
}
