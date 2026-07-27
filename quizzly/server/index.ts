import { createServer } from "node:http";
import { parse } from "node:url";

import { loadEnvConfig } from "@next/env";
import next from "next";

/**
 * Custom server.
 *
 * Next.js is mounted programmatically so Socket.IO can share the same HTTP
 * server and port. That is the whole reason this file exists: a live quiz needs
 * a persistent bidirectional connection, and serverless request/response
 * platforms can't hold one open. One process, one port, real WebSockets —
 * which also makes the container trivially deployable anywhere that runs Docker.
 */

/**
 * Load `.env` files before anything else.
 *
 * `next dev` does this for you, but we are the entry point now, so nothing has
 * populated `process.env` from `.env` yet. This must run before any import that
 * reads configuration — hence the dynamic imports further down rather than
 * top-level ones, which would be hoisted above this call and see an empty
 * environment.
 *
 * In production the real values normally come from the container environment,
 * where this call simply finds nothing to load and does no harm.
 */
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

async function main() {
  const { env } = await import("@/lib/env");
  const { db } = await import("@/lib/db");
  const { attachRealtime } = await import("./realtime/gameServer");

  const dev = env.NODE_ENV !== "production";

  const app = next({ dev, hostname: "0.0.0.0", port: env.PORT });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((req, res) => {
    // `parse` is required so Next receives the query object it expects.
    handle(req, res, parse(req.url ?? "/", true)).catch((err) => {
      console.error("[http] request handler failed", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    });
  });

  const io = attachRealtime(server);

  server.listen(env.PORT, () => {
    console.log(`\n  Quizzly ready on ${env.APP_ORIGIN}`);
    console.log(`  Mode: ${dev ? "development" : "production"}`);
    console.log(
      `  AI generation: ${env.ANTHROPIC_API_KEY ? `enabled (${env.AI_MODEL})` : "not configured — set ANTHROPIC_API_KEY to switch it on"}\n`,
    );
  });

  // ── Graceful shutdown ──
  // Container platforms send SIGTERM and then SIGKILL a few seconds later.
  // Closing cleanly means in-flight answers finish writing and sockets get a
  // proper close frame instead of players seeing a silent freeze.
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n[shutdown] ${signal} received, closing down`);

    const force = setTimeout(() => {
      console.error("[shutdown] took too long, forcing exit");
      process.exit(1);
    }, 10_000);
    force.unref();

    try {
      io.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.$disconnect();
      console.log("[shutdown] clean");
      process.exit(0);
    } catch (err) {
      console.error("[shutdown] failed", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // A rejected promise nobody handled has already put us in an unknown state.
  // Log it loudly rather than letting Node's default kill the process silently.
  process.on("unhandledRejection", (reason) => {
    console.error("[fatal] unhandled promise rejection", reason);
  });
}

main().catch((err) => {
  console.error("[boot] failed to start", err);
  process.exit(1);
});
