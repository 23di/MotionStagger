#!/usr/bin/env node
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const distDir = resolve(root, "dist");

rmSync(distDir, { recursive: true, force: true });

const result = await build({
  entryPoints: [resolve(root, "src/ui/main.tsx")],
  bundle: true,
  write: false,
  outdir: distDir,
  format: "iife",
  target: "es2021",
  platform: "browser",
  minify: true,
  plugins: [{
    name: "offline-dialkit-styles",
    setup(build) {
      build.onLoad({ filter: /dialkit\/dist\/styles\.css$/ }, ({ path }) => ({
        // DialKit's only remote asset is an optional Google Fonts import.
        // Use the iframe's system monospace stack with no network permissions.
        contents: readFileSync(path, "utf8").replace(/^@import url\('https:\/\/fonts\.googleapis\.com\/[^']+'\);\s*/m, ""),
        loader: "css",
        resolveDir: dirname(path),
      }));
    },
  }],
  loader: { ".tsx": "tsx", ".ts": "ts", ".css": "css" },
  jsx: "automatic"
});

let js = "";
let css = "";
for (const file of result.outputFiles) {
  if (file.path.endsWith(".js")) js = file.text;
  if (file.path.endsWith(".css")) css = file.text;
}

const safeJs = js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
if (/@import\b|url\(\s*["']?(?:https?:)?\/\//i.test(css)) {
  throw new Error("Plugin styles must remain self-contained; found a remote stylesheet or asset.");
}
const notices = readFileSync(resolve(root, "THIRD_PARTY_NOTICES.txt"), "utf8").replace(/--/g, "&#45;&#45;");
const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><!--${notices}--><style>${css}</style></head><body><div id="root"></div><script>${safeJs}</script></body></html>`;

mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(distDir, "index.html"), html, "utf8");
console.log(`[build-ui] OK — ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
