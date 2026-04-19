import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from "vite";
import type { Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import type { IncomingMessage, ServerResponse } from "node:http";

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
 * Plugin that enables ad-network and ownership verification without JavaScript:
 * 1. Serves /ads.txt dynamically from the API server's admin_config table
 * 2. Injects head_meta_tags (e.g. <meta name="google-adsense-account"…>) into
 *    <head> at the server level so crawlers see them in raw HTML
 * 3. Injects body_scripts before </body> at the server level for server-side
 *    inclusion (e.g. analytics tags that benefit from early loading)
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
      if (!res.ok) {
        cache[key] = { value: cache[key]?.value ?? "", expiresAt: now + TTL };
        return cache[key].value;
      }
      const ct = res.headers.get("content-type") ?? "";
      let value: string;
      if (ct.includes("application/json")) {
        const json = await res.json() as Record<string, string>;
        value = json.tags ?? json.scripts ?? "";
      } else {
        value = await res.text();
      }
      cache[key] = { value, expiresAt: now + TTL };
      return value;
    } catch {
      return cache[key]?.value ?? "";
    }
  }

  type NextFn = Connect.NextFunction;

  async function handleAdsTxt(
    req: IncomingMessage,
    res: ServerResponse,
    next: NextFn,
  ): Promise<void> {
    const url = (req.url ?? "").split("?")[0];
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
  }

  function attachAdsTxtMiddleware(
    middlewares: ViteDevServer["middlewares"] | PreviewServer["middlewares"],
  ): void {
    middlewares.use(handleAdsTxt as Connect.NextHandleFunction);
  }

  return {
    name: "minenova-ad-verification",

    configureServer(server: ViteDevServer) {
      attachAdsTxtMiddleware(server.middlewares);
    },

    configurePreviewServer(server: PreviewServer) {
      attachAdsTxtMiddleware(server.middlewares);
    },

    async transformIndexHtml(html: string): Promise<string> {
      const [headTags, bodyScripts] = await Promise.all([
        fetchCached("head_meta", `${API_BASE}/api/head-meta`),
        fetchCached("body_scripts", `${API_BASE}/api/body-scripts`),
      ]);
      if (headTags.trim()) {
        html = html.replace("</head>", `  ${headTags.trim()}\n  </head>`);
      }
      if (bodyScripts.trim()) {
        html = html.replace("</body>", `  ${bodyScripts.trim()}\n  </body>`);
      }
      return html;
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
