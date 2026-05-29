import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  root: "src/client",
  plugins: [tailwindcss(), svelte({ configFile: "../../svelte.config.mjs" })],
  publicDir: false,
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
