import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    tailwindcss({
      // 排除纯 CSS 文件，只处理 Tailwind 类
      scan: {
        exclude: ["src/styles/starcore.css", "src/styles/layout.css"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@openstar/core": path.resolve(__dirname, "../core/src/index.ts"),
      "@openstar/browser": path.resolve(__dirname, "../browser/src/index.ts"),
      "@openstar/canvas": path.resolve(__dirname, "../canvas/src/index.ts"),
      "@openstar/pet": path.resolve(__dirname, "../pet/src/index.ts"),
      "@openstar/templates": path.resolve(__dirname, "../templates/src/index.ts"),
      "@openstar/relay": path.resolve(__dirname, "../relay/src/index.ts"),
      "@openstar/swarm": path.resolve(__dirname, "../swarm/src/index.ts"),
    },
  },
  server: { port: 4446, host: true, strictPort: true },
  build: {
    outDir: "dist",
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name].[hash].css",
        entryFileNames: "index.[format].js",
      },
    },
  },
});