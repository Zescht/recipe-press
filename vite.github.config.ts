import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./github", import.meta.url)),
  base: process.env.RECIPE_PRESS_BASE ?? "/recipe-press/",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  css: {
    postcss: projectRoot,
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-github", import.meta.url)),
    emptyOutDir: true,
  },
});
