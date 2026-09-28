import replace from "@rollup/plugin-replace";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import istanbul from "vite-plugin-istanbul";

export default defineConfig(({ mode }) => ({
  server: {
    port: 8888,
  },
  build: {
    // vite-plugin-istanbul turns this back on when it runs during `vite build`.
    sourcemap: false,
  },
  plugins: [
    replace({
      preventAssignment: true,
      include: /\/jsonlint-lines-primitives\/lib\/jsonlint.js/,
      delimiters: ["", ""],
      values: {
        "_token_stack:": "",
      },
    }),
    react(),
    // Coverage instrumentation is for the Cypress dev server only.
    // During a production build the plugin forces a .js.map that exceeds Cloudflare's 25 MiB limit.
    mode === "production" ? null : istanbul({
      cypress: true,
      requireEnv: false,
      nycrcPath: "./.nycrc.json",
    }),
    {
      name: "drop-sourcemaps",
      apply: "build",
      enforce: "post",
      generateBundle(_options, bundle) {
        for (const fileName of Object.keys(bundle)) {
          if (fileName.endsWith(".map")) {
            delete bundle[fileName];
          }
        }
      },
    },
  ],
  base: "/",
  define: {
    global: "window"
  },
}));
