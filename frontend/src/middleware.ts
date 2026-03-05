import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const NO_CACHE = "no-cache, no-store, must-revalidate";

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", NO_CACHE);
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export const config = {
  // Do not run middleware for Next static assets; matching those can break CSS/JS delivery.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
