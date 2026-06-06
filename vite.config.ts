import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { appIconsPlugin } from "./vite/app-icons-plugin";

export default defineConfig({
  root: "src/client",
  plugins: [
    tailwindcss(),
    svelte({ configFile: false, preprocess: vitePreprocess() }),
    appIconsPlugin({
      name: "Bifrost",
      source: new URL("./src/client/assets/webcam.svg", import.meta.url),
      backgroundColor: "#f5faf7",
      themeColor: "#f5faf7",
    }),
  ],
  publicDir: false,
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
