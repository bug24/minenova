import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

/**
 * Plugin that enables ad-network verification without JavaScript:
 * 1. Serves /ads.txt dynamically from the API server's admin_config
 * 2. Injects head_meta_tags (e.g. <meta name="google-adsense-account"…>) into
 *    <head> at the server level so verification bots see them in raw HTML
 */
function adVerificationPlugin(): Plugin {
  const API_BASE =
    process.env.API_INTERNAL_URL ??
    `http://localhost:${process.env.API_PORT ?? "8080"}`;

  interface CacheEntry { value: string; expiresAt: number }
  const cache: Record<string, CacheEntry> = {};
  const TTL = 60_000;

  async function fetchCached(key: string, url: string): Promise<string> {
    const now = Date.now();
    if (cache[key] && now < cache[key].expiresAt) return cache[key].value;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      const value = res.ok
        ? res.headers.get("content-type")?.includes("json")
          ? ((await res.json()).tags ?? "")
          : await res.text()
        : cache[key]?.value ?? "";
      cache[key] = { value, expiresAt: now + TTL };
      return value;
    } catch {
      return cache[key]?.value ?? "";
    }
  }

  function attachAdsTxtMiddleware(server: { middlewares: { use: Function } }) {
    server.middlewares.use(async (req: any, res: any, next: Function) => {
      const url: string = (req.url ?? "").split("?")[0];
      if (url !== "/ads.txt" && url !== `${basePath}ads.txt`) {
        next();
        return;
      }
      const content = await fetchCached("ads_txt", `${API_BASE}/api/ads-txt`);
      if (!content.trim()) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not found");
        return;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(content);
    });
  }

  return {
    name: "minenova-ad-verification",

    configureServer(server) {
      attachAdsTxtMiddleware(server as any);
    },

    configurePreviewServer(server) {
      attachAdsTxtMiddleware(server as any);
    },

    async transformIndexHtml(html) {
      const tags = await fetchCached(
        "head_meta",
        `${API_BASE}/api/head-meta`,
      );
      if (!tags.trim()) return html;
      return html.replace("</head>", `  ${tags.trim()}\n  </head>`);
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    adVerificationPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
