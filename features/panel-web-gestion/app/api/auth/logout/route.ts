import { NextRequest, NextResponse } from "next/server";
import { buildPanelUrl, clearPanelSessionCookie } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const redirectUrl = buildPanelUrl(request, "/login");
  const response = NextResponse.redirect(redirectUrl);
  clearPanelSessionCookie(response);
  return response;
}
