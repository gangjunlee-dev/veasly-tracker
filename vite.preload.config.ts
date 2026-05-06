import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "chrome124",
    sourcemap: true,
    emptyOutDir: false,
    lib: {
      entry: "src/main/preload.ts",
      formats: ["cjs"],
      fileName: () => "preload.js"
    },
    rollupOptions: {
      external: ["electron"]
    }
  }
});
