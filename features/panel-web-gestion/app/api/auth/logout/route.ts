import { NextRequest, NextResponse } from "next/server";
import { getPanelPublicOrigin, PANEL_SESSION_COOKIE } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const redirectUrl = new URL("/login", getPanelPublicOrigin(request));
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(PANEL_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
