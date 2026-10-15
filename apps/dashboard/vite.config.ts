import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync, existsSync } from "node:fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rootDir = path.resolve(import.meta.dirname, "..", "..");

// Load root .env so vite.config can access process.env.PORT etc.
const rootEnvPath = path.resolve(rootDir, ".env");
if (existsSync(rootEnvPath)) {
  const lines = readFileSync(rootEnvPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = val;
    }
  }
}

const isBuild = process.env.NODE_ENV === "production" || process.argv.includes("build");

const isDev = !isBuild && process.env.REPL_ID === undefined;

const rawPort = process.env.PORT;
if (isDev && !rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}
// Dashboard uses DASHBOARD_PORT if set, otherwise falls back to PORT
const port = Number(
  process.env.DASHBOARD_PORT ?? rawPort ?? "5173"
);

// Base path: dev always "/" (proxy to remote VPS), production from env
const basePath = isBuild
  ? (process.env.BASE_PATH ?? "/")
  : "/";

export default defineConfig({
  base: basePath,
  envDir: rootDir,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
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
      "@workspace/api-client-react": path.resolve(import.meta.dirname, "..", "..", "lib", "api-client-react", "src", "index.ts"),
      "@workspace/api-zod": path.resolve(import.meta.dirname, "..", "..", "lib", "api-zod", "src", "index.ts"),
      "@workspace/db": path.resolve(import.meta.dirname, "..", "..", "lib", "db", "src", "index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("recharts")) return "vendor-charts";
            if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) return "vendor-motion";
            if (id.includes("xlsx") || id.includes("ssf")) return "vendor-xlsx";
            if (id.includes("@radix-ui/")) return "vendor-radix";
            if (id.includes("@tanstack/react-query")) return "vendor-query";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("wouter")) return "vendor-router";
            if (id.includes("zod")) return "vendor-zod";
            if (id.includes("date-fns")) return "vendor-date";
            if (id.includes("tailwindcss") || id.includes("@tailwindcss")) return "vendor-css";
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    root: path.resolve(import.meta.dirname, "dist/public"),
  },
});
