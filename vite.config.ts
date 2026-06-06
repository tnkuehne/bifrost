import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { appIconsPlugin } from "./vite/app-icons-plugin";

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte({ configFile: false, preprocess: vitePreprocess() }),
    appIconsPlugin({
      name: "Bifrost",
      source: new URL("./src/client/assets/webcam.svg", import.meta.url),
      backgroundColor: "#f5faf7",
      themeColor: "#f5faf7",
    }),
    cloudflare({ tunnel: true }),
  ],
});
