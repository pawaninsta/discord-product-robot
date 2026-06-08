import boltPkg from "@slack/bolt";
import { registerHandlers } from "./slack/handlers.js";

const { App } = boltPkg;

/**
 * Slack entry point for the whiskey product robot — a parallel interface to the
 * Discord bot (index.js). It reuses the SAME core pipeline (pipeline.js) and
 * tasting-card generator (tasting-card.js).
 *
 * Transport modes:
 *   - Socket Mode (default, recommended): no public URL required. Needs
 *     SLACK_APP_TOKEN (an app-level token with `connections:write`) plus
 *     SLACK_BOT_TOKEN.
 *   - HTTP mode (alternative): set SLACK_SOCKET_MODE=false and provide
 *     SLACK_SIGNING_SECRET; Slack will POST events to your public endpoint.
 *
 * Config via process.env only (no dotenv) — Railway injects env vars.
 */

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// Socket Mode unless explicitly disabled.
const socketMode = String(process.env.SLACK_SOCKET_MODE ?? "true").toLowerCase() !== "false";
const port = Number(process.env.PORT || process.env.SLACK_PORT || 3001);

console.log("SLACK_BOT_TOKEN exists:", Boolean(SLACK_BOT_TOKEN));
console.log("SLACK mode:", socketMode ? "socket" : "http");

function buildApp() {
  if (!SLACK_BOT_TOKEN) {
    throw new Error("SLACK_BOT_TOKEN is required");
  }

  if (socketMode) {
    if (!SLACK_APP_TOKEN) {
      throw new Error("SLACK_APP_TOKEN is required for Socket Mode (set SLACK_SOCKET_MODE=false to use HTTP mode)");
    }
    return new App({
      token: SLACK_BOT_TOKEN,
      appToken: SLACK_APP_TOKEN,
      socketMode: true
    });
  }

  if (!SLACK_SIGNING_SECRET) {
    throw new Error("SLACK_SIGNING_SECRET is required for HTTP mode");
  }
  return new App({
    token: SLACK_BOT_TOKEN,
    signingSecret: SLACK_SIGNING_SECRET
  });
}

async function main() {
  const app = buildApp();

  registerHandlers(app);

  // Surface Bolt-level errors instead of crashing silently.
  app.error(async (error) => {
    console.error("SLACK APP ERROR:", error);
  });

  await app.start(socketMode ? undefined : port);
  console.log(`🥃 Slack robot is online${socketMode ? " (Socket Mode)" : ` on port ${port}`}`);
}

main().catch((err) => {
  console.error("SLACK STARTUP FAILED:", err);
  process.exit(1);
});
