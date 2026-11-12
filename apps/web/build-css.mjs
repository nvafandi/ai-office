import { compile } from "tailwindcss";
import { readFile, writeFile } from "fs/promises";

const css = await readFile("apps/web/public/styles/input.css", "utf8");
const indexCss = await readFile("node_modules/tailwindcss/index.css", "utf8");

const compiled = await compile(css, {
  loadStylesheet: async (id) => ({
    path: id,
    base: process.cwd(),
    content: id === "tailwindcss" ? indexCss : "",
  }),
});

// Kumpulkan kelas utilitas yang dipakai di HTML/JS agar build menghasilkan CSS untuknya.
const src = await Promise.all([
  readFile("apps/web/public/index.html", "utf8"),
  readFile("apps/web/public/app.js", "utf8"),
]);
const literal = new Set();
for (const s of src) {
  for (const m of s.matchAll(/class=["']([^"']*)["']/g)) {
    for (const c of m[1].split(/\s+/)) if (c) literal.add(c);
  }
  for (const m of s.matchAll(/className\s*=\s*["']([^"']*)["']/g)) {
    for (const c of m[1].split(/\s+/)) if (c) literal.add(c);
  }
}

// Kelas yang disusun secara dinamis di setMsg (tidak terbaca dari literal di atas).
for (const c of [
  "block",
  "hidden",
  "bg-[#1a4a3a]",
  "text-[#6ee7b7]",
  "border-[#45a29e]",
  "bg-[#4a1a1a]",
  "text-[#fca5a5]",
  "border-[#7f1d1d]",
]) literal.add(c);

const output = compiled.build([...literal]);
await writeFile("apps/web/public/styles/tailwind.css", output);
