// Verifies that lv.json and en.json have identical keys and that every
// translation key referenced in the source exists. Run: node scripts/check-locales.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const flat = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
const lv = new Set(flat(JSON.parse(readFileSync("locales/lv.json", "utf8"))));
const en = new Set(flat(JSON.parse(readFileSync("locales/en.json", "utf8"))));

let failed = false;
const fail = (msg) => { console.error(msg); failed = true; };
for (const k of lv) if (!en.has(k)) fail(`missing in en.json: ${k}`);
for (const k of en) if (!lv.has(k)) fail(`missing in lv.json: ${k}`);

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|svelte)$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
});
const sections = new Set([...lv].map((k) => k.split(".")[0]));
const keyRe = /["'`]([a-z_]+\.[a-z0-9_]+)["'`]/g;
for (const file of walk("src")) {
  for (const [, key] of readFileSync(file, "utf8").matchAll(keyRe)) {
    if (!sections.has(key.split(".")[0])) continue; // not a translation key
    const ok = lv.has(key) || lv.has(`${key}_one`);
    if (!ok) fail(`${file}: unknown key ${key}`);
  }
}
// Keys built dynamically in Rust (src-tauri/src/menu.rs) and in the store's undo labels.
const src = readFileSync("src-tauri/src/menu.rs", "utf8");
for (const [, id] of src.matchAll(/item\("([a-z_]+)"/g)) if (!lv.has(`menu.${id}`)) fail(`menu.rs: missing menu.${id}`);
for (const [, id] of readFileSync("src/lib/db/store.svelte.ts", "utf8").matchAll(/tx\(\s*(?:done \? )?"([a-z_]+)"(?: : "([a-z_]+)")?/g))
  if (!lv.has(`undo.${id}`)) fail(`store: missing undo.${id}`);

console.log(failed ? "locale check FAILED" : `locale check OK (${lv.size} keys)`);
process.exit(failed ? 1 : 0);
