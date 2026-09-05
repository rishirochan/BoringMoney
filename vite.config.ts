import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    ...(command === "serve"
      ? [
          {
            name: "development-csp",
            transformIndexHtml: (html: string) =>
              html.replace(
                "script-src 'self';",
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws:;"
              ),
          },
        ]
      : []),
  ],
}));
