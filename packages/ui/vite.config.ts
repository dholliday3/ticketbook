import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4242",
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("prosemirror") || id.includes("@tiptap/pm")) return "prosemirror";
            if (id.includes("@tiptap") || id.includes("tiptap-markdown")) return "tiptap";
            if (id.includes("@dnd-kit")) return "dndkit";
            if (id.includes("lowlight") || id.includes("highlight.js")) return "lowlight";
          }
        },
      },
    },
  },
});
