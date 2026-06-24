import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

const SERVER_ROOT = "/mnt/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: serviceId } = await context.params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;
  const apiBase = `${origin}/api/control`;

  return NextResponse.json({
    service_id: serviceId,
    api_base: apiBase,
    root: SERVER_ROOT,
    list_endpoint: `/services/${serviceId}/files`,
    read_endpoint: `/services/${serviceId}/files/read`,
    write_endpoint: `/services/${serviceId}/files/write`,
    sync_script_url: "/vivox-sync/vivox-file-sync.mjs",
    token_hint:
      "Use the JWT from the Vivox panel session (Copy JWT in the sync modal) or set VIVOX_TOKEN.",
  });
}
