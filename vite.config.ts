import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

function crossOriginIsolationPlugin() {
  const applyHeaders = (res: { setHeader: (name: string, value: string) => void }) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  };

  return {
    name: "cross-origin-isolation",
    configureServer(server: { middlewares: { use: (fn: (req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((_req, res, next) => {
        applyHeaders(res);
        next();
      });
    },
    configurePreviewServer(server: { middlewares: { use: (fn: (req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((_req, res, next) => {
        applyHeaders(res);
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH ?? (mode === "production" ? "/vidscribe-studio/" : "/"),
  server: {
    host: "localhost",
    port: 8080,
    strictPort: true,
    hmr: {
      overlay: false,
    },
  },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  plugins: [crossOriginIsolationPlugin(), react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
