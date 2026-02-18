import { NextRequest, NextResponse } from "next/server";
import { PANEL_SESSION_COOKIE } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const redirectUrl = new URL("/login", request.url);
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
