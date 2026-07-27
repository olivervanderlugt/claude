import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/**
 * Health check for container orchestrators and uptime monitors.
 *
 * Checks the database too, not just "is the process alive" — a Node process
 * that can't reach Postgres serves nothing useful, and a healthcheck that
 * passes anyway keeps traffic routed to a broken instance.
 *
 * Deliberately returns no version, hostname, or dependency detail. This
 * endpoint is unauthenticated, and health endpoints are a well-worn way to
 * fingerprint an unpatched deployment.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
