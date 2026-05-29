import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: false,
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
