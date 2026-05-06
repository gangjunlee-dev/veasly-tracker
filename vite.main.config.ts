import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node20",
    sourcemap: true,
    emptyOutDir: false,
    lib: {
      entry: "src/main/index.ts",
      formats: ["cjs"],
      fileName: () => "main.js"
    },
    rollupOptions: {
      external: [
        "electron",
        "better-sqlite3",
        "keytar",
        "playwright"
      ]
    }
  }
});
