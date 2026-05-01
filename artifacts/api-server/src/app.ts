import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { db, adminConfigTable, referralEarningsTable, usersTable } from "@workspace/db";
import { and, eq, lte, sql } from "drizzle-orm";

// ─── Paths ─────────────────────────────────────────────────────────────────────

// `import.meta.dirname` resolves to the directory of the *bundled* output file
// at runtime (e.g. artifacts/api-server/dist/), so two levels up lands in
// artifacts/, then we navigate into minenova/dist/public.
const DIST_DIR =
  process.env.MINENOVA_DIST ??
  path.resolve(import.meta.dirname, "../../minenova/dist/public");
const INDEX_HTML = path.join(DIST_DIR, "index.html");
const VITE_PORT = Number(process.env.VITE_PORT ?? "25887");

// ─── Admin config cache (60s TTL) ────────────────────────────────────────────

interface ConfigCache { headTags: string; bodyScripts: string; adsTxt: string; expiresAt: number }
let configCache: ConfigCache | null = null;

async function getHtmlConfig(): Promise<ConfigCache> {
  const now = Date.now();
  if (configCache && now < configCache.expiresAt) return configCache;
  try {
    const all = await db
      .select({ key: adminConfigTable.key, value: adminConfigTable.value })
      .from(adminConfigTable);
    const map: Record<string, string> = {};
    for (const r of all) map[r.key] = r.value;
    configCache = {
      headTags: map["head_meta_tags"] ?? "",
      bodyScripts: map["body_scripts"] ?? "",
      adsTxt: map["ads_txt"] ?? "",
      expiresAt: now + 60_000,
    };
    return configCache;
  } catch {
    return configCache ?? { headTags: "", bodyScripts: "", adsTxt: "", expiresAt: now + 5_000 };
  }
}

// ─── HTML injection ───────────────────────────────────────────────────────────

async function serveInjectedHtml(res: express.Response): Promise<void> {
  let html: string;
  try {
    html = fs.readFileSync(INDEX_HTML, "utf-8");
  } catch {
    res.status(503).send("React app not built. Run: pnpm --filter @workspace/minenova build");
    return;
  }
  const { headTags, bodyScripts } = await getHtmlConfig();
  if (headTags.trim()) {
    html = html.replace("</head>", `  ${headTags.trim()}\n  </head>`);
  }
  if (bodyScripts.trim()) {
    html = html.replace("</body>", `  ${bodyScripts.trim()}\n  </body>`);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
}

// ─── Vite dev server proxy (used when dist/ doesn't exist) ───────────────────

function proxyToVite(req: IncomingMessage, res: ServerResponse): void {
  const options = {
    hostname: "127.0.0.1",
    port: VITE_PORT,
    path: req.url ?? "/",
    method: req.method ?? "GET",
    headers: { ...req.headers, host: `127.0.0.1:${VITE_PORT}` },
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxy.on("error", () => {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Vite dev server unavailable (port " + VITE_PORT + "). Ensure the minenova workflow is running.");
  });
  proxy.end();
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── /ads.txt — served at domain root, visible to ad network crawlers ─────────

app.get("/ads.txt", async (_req, res): Promise<void> => {
  const { adsTxt } = await getHtmlConfig();
  if (!adsTxt.trim()) {
    res.status(404).setHeader("Content-Type", "text/plain; charset=utf-8").end("Not found");
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(adsTxt);
});

// ─── API routes ───────────────────────────────────────────────────────────────

app.use("/api", router);

// ─── Static assets + SPA catch-all ───────────────────────────────────────────

const distBuilt = fs.existsSync(INDEX_HTML);

if (distBuilt) {
  logger.info({ distDir: DIST_DIR }, "Serving React app as static files");

  app.use(
    express.static(DIST_DIR, {
      index: false,
      setHeaders(res) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );

  app.get("/{*path}", async (req, res): Promise<void> => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await serveInjectedHtml(res);
  });
} else {
  logger.warn(
    { distDir: DIST_DIR, vitePort: VITE_PORT },
    "React dist not found — proxying all non-API requests to Vite dev server",
  );

  app.use((req, res): void => {
    proxyToVite(req, res);
  });
}

// ─── Hourly cron: unlock eligible referral USDT earnings ─────────────────────

async function unlockEligibleReferralEarnings(): Promise<void> {
  try {
    const now = new Date();
    const eligible = await db
      .select()
      .from(referralEarningsTable)
      .where(and(eq(referralEarningsTable.status, "locked"), lte(referralEarningsTable.unlockDate, now)));

    if (eligible.length === 0) return;

    for (const earning of eligible) {
      await db
        .update(usersTable)
        .set({
          usdtBalance: sql`usdt_balance + ${earning.rewardLockedUsdt}`,
          lockedUsdtBalance: sql`greatest(0, locked_usdt_balance - ${earning.rewardLockedUsdt})`,
        })
        .where(eq(usersTable.id, earning.referrerId));

      await db
        .update(referralEarningsTable)
        .set({ status: "unlocked" })
        .where(eq(referralEarningsTable.id, earning.id));
    }

    logger.info({ count: eligible.length }, "Unlocked referral USDT earnings");
  } catch (err) {
    logger.error({ err }, "Failed to unlock referral earnings in cron");
  }
}

setInterval(unlockEligibleReferralEarnings, 60 * 60 * 1000);
unlockEligibleReferralEarnings().catch(() => {});

export default app;
