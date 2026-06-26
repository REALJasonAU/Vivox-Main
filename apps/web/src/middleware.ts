import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/** Routes reachable without a session. */
const PUBLIC_PATHS = ["/login", "/register"];

/**
 * The app's public base URL. Set as a build arg (NEXT_PUBLIC_APP_URL) so it
 * is baked into the bundle and available in the Edge Runtime. Falls back to
 * proxy-forwarded headers, then the raw request URL.
 *
 * This is the authoritative source for redirect URLs — it prevents the
 * middleware from ever redirecting to the internal Docker address
 * (localhost:3001) when running behind Pangolin or another reverse proxy.
 */
const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

function externalRedirect(request: NextRequest, pathname: string, params?: Record<string, string>) {
  let base: string;

  if (APP_BASE_URL) {
    // Build arg was set at image build time — always use the canonical domain.
    base = APP_BASE_URL;
  } else {
    // Fallback: trust proxy-forwarded headers (X-Forwarded-Host / X-Forwarded-Proto).
    const host =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      request.nextUrl.host;
    const proto =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      request.nextUrl.protocol.replace(":", "") ??
      "https";
    base = `${proto}://${host}`;
  }

  const url = new URL(pathname, base);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return url;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Optimistic cookie check (does not validate the session — the Go API does
  // full verification on each request). Good enough to gate navigation.
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie && !isPublic) {
    return NextResponse.redirect(
      externalRedirect(request, "/login", { redirect: pathname })
    );
  }

  if (sessionCookie && isPublic) {
    const redirectTo = request.nextUrl.searchParams.get("redirect");
    const target =
      redirectTo &&
      redirectTo.startsWith("/") &&
      !redirectTo.startsWith("//") &&
      !PUBLIC_PATHS.some((p) => redirectTo === p || redirectTo.startsWith(`${p}/`))
        ? redirectTo
        : "/dashboard";
    return NextResponse.redirect(externalRedirect(request, target));
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except API routes, Next internals, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
