import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { appIconsPlugin } from "./vite/app-icons-plugin";

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte({ configFile: false, preprocess: vitePreprocess() }),
    appIconsPlugin(),
    cloudflare({ tunnel: true }),
  ],
});
