import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const isBuild = process.env.NODE_ENV === "production" || process.argv.includes("build");

const isDev = !isBuild && process.env.REPL_ID === undefined;

const rawPort = process.env.PORT;
if (isDev && !rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}
const port = Number(rawPort ?? "5000");

// Base path: dev always "/" (proxy to remote VPS), production from env
const basePath = isBuild
  ? (process.env.BASE_PATH ?? "/")
  : "/";

export default defineConfig({
  base: basePath,
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
  },
});
