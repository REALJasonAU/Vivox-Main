import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/** Routes reachable without a session. */
const PUBLIC_PATHS = ["/login", "/register"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Optimistic cookie check (does not validate the session — the Go API does
  // full verification on each request). Good enough to gate navigation.
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (sessionCookie && isPublic) {
    const url = request.nextUrl.clone();
    const redirectTo = request.nextUrl.searchParams.get("redirect");
    if (
      redirectTo &&
      redirectTo.startsWith("/") &&
      !redirectTo.startsWith("//") &&
      !PUBLIC_PATHS.some((p) => redirectTo === p || redirectTo.startsWith(`${p}/`))
    ) {
      url.pathname = redirectTo;
    } else {
      url.pathname = "/dashboard";
    }
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except API routes, Next internals, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
