#!/usr/bin/env node
// Checks a tree meant for the public repository of the npm packages (docs/publishing.md, option B). It runs
// on the copy before it leaves the private repository (scripts/publish/copy-public.mjs) and again on every
// pull request of the public repository (its check workflow). Exit code 1 when anything is found.
//
//   node scripts/publish/check-public.mjs [dir]       dir defaults to the repository this script is in
//
// It refuses:
//   - an import of a workspace that is not in the tree (@overtable/relay, @overtable/conformance, or any other
//     @overtable/* that is not a folder of packages/), and a relative import or a new URL() on import.meta.url
//     that leaves the tree or points at a file that is not there;
//   - the owner's name, in any file. The words are kept as SHA-256 hashes so this file does not print them;
//   - in Markdown: roadmap content, and dates outside fenced code blocks (a protocol version in a quickstart is
//     code), except the date of a CHANGELOG version heading: "## 1.2.3 (yyyy-mm-dd)".
// Secrets are the job of gitleaks, run next to this script (`gitleaks dir`).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".publish", ".cache", "coverage"]);
const CODE = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".tsx"]);
const TEXT = new Set([...CODE, ".md", ".json", ".yml", ".yaml", ".txt", ".sh", ""]);
/** sha256 of each lower-case word of the owner's name and handles. */
const NAME_HASHES = new Set([
  "4418054fa1093a61b0038e3f3cf34d01c7591582df460ff2f34a87269d60ca08",
  "251cebdc48e3f84206770f3e2e1076116447ddf79cfe9d71e8adb119408101dd",
  "f9271c1b8be4284b0045def359d4dd0daa5b53d4ec640c171bb3c1529622680e",
]);
const ROADMAP = /\broad ?map\b|scenarios\.md|\bwave [0-9]\b|\bYC\b|Y Combinator/i;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATES = [/\b(19|20)\d\d-\d\d-\d\d\b/, new RegExp(`\\b(${MONTHS}) \\d{1,2},? (19|20)\\d\\d\\b`), new RegExp(`\\b\\d{1,2} (${MONTHS}) (19|20)\\d\\d\\b`)];
const CHANGELOG_HEADING = /^##\s+\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\s+\((19|20)\d\d-\d\d-\d\d\)\s*$/;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    if (SKIP_DIRS.has(f)) return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const packageOf = (id) => (id.startsWith("@") ? id.split("/").slice(0, 2).join("/") : id.split("/")[0]);
const isBuiltin = (id) => id.startsWith("node:") || builtinModules.includes(id.split("/")[0]);

/** Module specifiers of a source file: static and dynamic imports, re-exports, require, and new URL() on import.meta.url. */
export function specifiersOf(text) {
  const ids = new Set();
  for (const m of text.matchAll(/^\s*(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']/gm)) ids.add(m[1]);
  for (const m of text.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) ids.add(m[1]);
  for (const m of text.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) ids.add(m[1]);
  for (const m of text.matchAll(/\bnew URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) ids.add(m[1]);
  return [...ids];
}

/** The file a relative specifier lands on, TypeScript style (./a.js may be ./a.ts), or null. */
function resolveRelative(from, spec) {
  const base = resolve(dirname(from), spec);
  const candidates = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.mjs$/, ".mts"), `${base}.ts`, `${base}.js`, join(base, "index.ts"), join(base, "index.js")];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export function nameWords(text) {
  const found = new Set();
  for (const m of text.matchAll(/[A-Za-z]+/g)) {
    const w = m[0].toLowerCase();
    if (w.length < 6 || w.length > 12) continue;
    if (NAME_HASHES.has(createHash("sha256").update(w).digest("hex"))) found.add(m[0]);
  }
  return [...found];
}

/** Problems of the tree at dir: one line each, with the file and the line number when there is one. */
export function checkTree(dir) {
  const root = resolve(dir);
  const problems = [];
  const workspaces = new Set(
    existsSync(join(root, "packages"))
      ? readdirSync(join(root, "packages"))
          .filter((w) => existsSync(join(root, "packages", w, "package.json")))
          .map((w) => JSON.parse(readFileSync(join(root, "packages", w, "package.json"), "utf8")).name)
      : [],
  );
  for (const file of walk(root)) {
    const rel = relative(root, file);
    const ext = extname(file);
    if (!TEXT.has(ext)) continue;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      // The words are not printed: the log of a public check must not spell them out either.
      if (nameWords(line).length) problems.push(`${rel}:${i + 1}: the owner's name`);
    });
    if (CODE.has(ext)) {
      for (const spec of specifiersOf(text)) {
        if (spec.startsWith(".")) {
          const target = resolveRelative(file, spec);
          if (!target) problems.push(`${rel}: imports ${spec}, which is not in the tree`);
          else if (relative(root, target).startsWith(`..${sep}`) || relative(root, target) === "..") problems.push(`${rel}: imports ${spec}, outside the tree`);
          continue;
        }
        if (spec.startsWith("/") || spec.startsWith("file:")) {
          problems.push(`${rel}: imports the absolute path ${spec}`);
          continue;
        }
        if (isBuiltin(spec)) continue;
        const name = packageOf(spec);
        if (name.startsWith("@overtable/") && !workspaces.has(name)) problems.push(`${rel}: imports the private workspace ${name}`);
      }
    }
    if (ext === ".md") {
      const isChangelog = /(^|\/)CHANGELOG\.md$/.test(rel);
      let fenced = false;
      lines.forEach((line, i) => {
        if (ROADMAP.test(line)) problems.push(`${rel}:${i + 1}: roadmap content`);
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        if (fenced || (isChangelog && CHANGELOG_HEADING.test(line))) return;
        if (DATES.some((re) => re.test(line))) problems.push(`${rel}:${i + 1}: a date`);
      });
    }
  }
  return problems;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const problems = checkTree(dir);
  if (problems.length) {
    console.error(`check-public: ${problems.length} problem(s) in ${dir}:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check-public: no private import, no owner's name, no roadmap content and no date in ${dir}`);
}
