import { NextRequest, NextResponse } from "next/server";
import {
  createOAuthState,
  getDiscordOAuthConfig,
  redirectToLogin,
  setOAuthStateCookie,
} from "@/lib/auth";

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
    setOAuthStateCookie(response, state);
    return response;
  } catch {
    return redirectToLogin(request, "oauth_config");
  }
}
