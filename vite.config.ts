import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const filesChartsModules = [
  "/src/components/views/Files/FilesChartPreview.tsx",
  "/src/components/views/Files/LazyFilesChartPreview.tsx",
  "/src/components/views/Files/ChartPanel.tsx",
  "/src/hooks/useChartData.ts",
];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Prevent vite from obscuring rust errors
  clearScreen: false,
  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // Build optimizations for Raspberry Pi
  build: {
    emptyOutDir: true,
    target: "esnext",
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.split(path.sep).join("/");

          if (
            normalizedId.includes("/node_modules/uplot/") ||
            filesChartsModules.some((moduleId) => normalizedId.endsWith(moduleId))
          ) {
            return "files-charts";
          }

          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/")
          ) {
            return "react";
          }

          if (
            normalizedId.includes("/node_modules/i18next/") ||
            normalizedId.includes("/node_modules/react-i18next/")
          ) {
            return "i18n";
          }

          if (normalizedId.includes("/node_modules/zustand/")) {
            return "zustand";
          }
        },
      },
    },
  },
});
