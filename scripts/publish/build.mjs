#!/usr/bin/env node
// Builds the npm packages of scripts/publish/packages.json into .publish/<workspace>/, ready for
// `npm pack` or `npm publish` (docs/publishing.md). Publishes nothing.
//
//   node scripts/publish/build.mjs                    every package, version from packages.json
//   node scripts/publish/build.mjs --version 0.2.0    another version (the release workflow's input)
//   node scripts/publish/build.mjs --skip-tsc         the workspaces' dist/ is already built
//
// For each package: the workspace's own tsc build, then esbuild bundles its entries with every private
// workspace inlined (@overtable/shared, never @overtable/relay) and its npm dependencies left as imports;
// rollup-plugin-dts does the same for the types. The published package.json is written from packages.json
// and the workspace's dependency ranges. A check then refuses any import the package.json does not declare,
// and any file that is not the bundle, the README, the CHANGELOG, the LICENSE or a declared asset.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const CONFIG_PATH = join(ROOT, "scripts/publish/packages.json");
export const OUT = join(ROOT, ".publish");
const PRIVATE = ["@overtable/shared", "@overtable/relay", "@overtable/conformance"];

export function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What is wrong with a CHANGELOG for a version, or null. Every run needs a section `## <version>`; a real
 * publication (release: true) needs its heading dated, `## <version> (yyyy-mm-dd)`, so a heading that still
 * says "unreleased" never ships in a tarball.
 */
export function changelogProblem(text, version, { release = false } = {}) {
  const heading = text.split("\n").find((line) => new RegExp(`^##\\s+${escapeRe(version)}(\\s|$)`).test(line));
  if (!heading) return `has no section ## ${version}`;
  if (release && !new RegExp(`^##\\s+${escapeRe(version)}\\s+\\((19|20)\\d\\d-\\d\\d-\\d\\d\\)\\s*$`).test(heading.trimEnd()))
    return `heading "${heading.trim()}" is not "## ${version} (yyyy-mm-dd)": date it before a real publication`;
  return null;
}

/** The CHANGELOG problems of every package of packages.json for a version, one line each. */
export function changelogProblems(config, version, options) {
  return config.packages.flatMap((p) => {
    const path = join(ROOT, "packages", p.workspace, "CHANGELOG.md");
    if (!existsSync(path)) return [`packages/${p.workspace}/CHANGELOG.md is missing`];
    const problem = changelogProblem(readFileSync(path, "utf8"), version, options);
    return problem ? [`packages/${p.workspace}/CHANGELOG.md ${problem}`] : [];
  });
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const workspaceManifest = (ws) => readJson(join(ROOT, "packages", ws, "package.json"));
const isBuiltin = (id) => id.startsWith("node:") || builtinModules.includes(id.split("/")[0]);
/** The package name of a bare import: "@scope/name/sub" -> "@scope/name", "name/sub" -> "name". */
export const packageOf = (id) => (id.startsWith("@") ? id.split("/").slice(0, 2).join("/") : id.split("/")[0]);

/** Workspace name (as imported in this repo) -> published name, for the packages of the config. */
export function publishedNames(config) {
  return Object.fromEntries(config.packages.map((p) => [workspaceManifest(p.workspace).name, p.name]));
}

/** The published package.json of one package. */
export function manifestFor(config, pkg, version) {
  const ws = workspaceManifest(pkg.workspace);
  const names = publishedNames(config);
  const dependencies = {};
  for (const dep of pkg.dependencies) {
    if (names[dep]) {
      dependencies[names[dep]] = version; // published together, same version
      continue;
    }
    const range = ws.dependencies?.[dep];
    if (!range) throw new Error(`${pkg.name}: ${dep} is not a dependency of packages/${pkg.workspace}/package.json`);
    dependencies[dep] = range;
  }
  const exports = {};
  for (const key of Object.keys(pkg.entries)) {
    const base = key === "." ? "index" : key.slice(2);
    exports[key] = { types: `./dist/${base}.d.ts`, import: `./dist/${base}.js` };
  }
  if (pkg.jsonSchema) exports["./json-schema/*"] = "./dist/json-schema/*";
  exports["./package.json"] = "./package.json";
  const repo = config.repository.replace(/\/+$/, "");
  return {
    name: pkg.name,
    version,
    description: pkg.description,
    keywords: pkg.keywords,
    license: config.license,
    author: config.author,
    homepage: config.homepage,
    repository: { type: "git", url: `git+${repo}.git`, directory: `packages/${pkg.workspace}` },
    bugs: { url: config.bugs },
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports,
    ...(pkg.bin ? { bin: Object.fromEntries(Object.entries(pkg.bin).map(([name, src]) => [name, `./dist/${baseName(src)}.js`])) } : {}),
    // npm adds package.json, README and LICENSE by itself, not the CHANGELOG.
    files: ["dist", ...(pkg.assets ?? []), "CHANGELOG.md"],
    sideEffects: Boolean(pkg.bin),
    engines: { node: ">=20" },
    dependencies,
    publishConfig: { access: "public", provenance: true },
  };
}

const baseName = (src) => src.replace(/^src\//, "").replace(/\.ts$/, "");

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Bare imports of a bundled file (static, dynamic, re-exports, and `import("x")` types). */
export function importsOf(text) {
  const ids = new Set();
  // Statements at the start of a line, as esbuild and rollup write them: import/export ... from "x", import "x".
  for (const m of text.matchAll(/^\s*(?:import|export)\b[^;"']*?\bfrom\s*["']([^"']+)["']/gm)) ids.add(m[1]);
  for (const m of text.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) ids.add(m[1]);
  // import("x") and require("x"), in code and in types.
  for (const m of text.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) ids.add(m[1]);
  return [...ids].filter((id) => !id.startsWith(".") && !id.startsWith("/"));
}

/** Problems of a staged package: undeclared or private imports, files that do not belong. */
export function checkStaged(dir, manifest) {
  const problems = [];
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  const allowedTop = new Set(["package.json", "README.md", "CHANGELOG.md", "LICENSE", ...manifest.files]);
  for (const f of readdirSync(dir)) if (!allowedTop.has(f)) problems.push(`unexpected file ${f}`);
  for (const file of walk(dir)) {
    const rel = relative(dir, file);
    if (/\.(test|spec)\.|\.map$|(^|\/)src\/|\.tsbuildinfo$|(^|\/)\.env/.test(rel)) problems.push(`private or build file ${rel}`);
    if (!/\.(m?js|d\.ts)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    // The JSDoc of the types is what a user reads in the editor: no path to a file of the private repository.
    if (file.endsWith(".d.ts"))
      text.split("\n").forEach((line, i) => {
        if (/\bdocs\/[\w./-]+\.md\b|\bpackages\/(relay|conformance)\//.test(line)) problems.push(`${rel}:${i + 1} names a file of the private repository`);
      });
    for (const id of importsOf(text)) {
      if (isBuiltin(id)) continue;
      const name = packageOf(id);
      if (PRIVATE.includes(name)) problems.push(`${rel} imports the private workspace ${name}`);
      else if (!declared.has(name)) problems.push(`${rel} imports ${id}, not a dependency`);
    }
  }
  for (const f of ["README.md", "CHANGELOG.md", "LICENSE"]) if (!existsSync(join(dir, f))) problems.push(`missing ${f}`);
  return problems;
}

async function bundle(config, pkg, version, outDir) {
  const { build } = await import("esbuild");
  const { rollup } = await import("rollup");
  const { dts } = await import("rollup-plugin-dts");
  const manifest = manifestFor(config, pkg, version);
  const wsDir = join(ROOT, "packages", pkg.workspace);
  const external = [...Object.keys(manifest.dependencies), ...Object.keys(publishedNames(config))];
  const isExternal = (id) => isBuiltin(id) || external.includes(packageOf(id));

  const entryPoints = Object.fromEntries(
    [...Object.entries(pkg.entries).map(([key, src]) => [key === "." ? "index" : key.slice(2), src]), ...Object.values(pkg.bin ?? {}).map((src) => [baseName(src), src])].map(([name, src]) => [
      name,
      join(wsDir, src),
    ]),
  );
  await build({
    entryPoints,
    outdir: join(outDir, "dist"),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external: [...external, ...external.map((e) => `${e}/*`)],
    // Private workspaces resolve to their built JS (packages/*/dist) through node_modules, and are inlined.
    legalComments: "none",
    logLevel: "warning",
  });

  for (const key of Object.keys(pkg.entries)) {
    const base = key === "." ? "index" : key.slice(2);
    const input = join(wsDir, "dist", `${base}.d.ts`);
    const bundleDts = await rollup({ input, external: isExternal, plugins: [dts({ respectExternal: true })], onwarn: () => {} });
    await bundleDts.write({ file: join(outDir, "dist", `${base}.d.ts`), format: "es" });
    await bundleDts.close();
  }

  if (pkg.jsonSchema) {
    const { jsonSchemaFiles } = await import(pathToFileURL(join(wsDir, "dist/json-schema.js")).href);
    for (const [path, schema] of Object.entries(jsonSchemaFiles())) {
      const target = join(outDir, "dist/json-schema", path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`);
    }
  }

  // Imports of a sibling package use its workspace name in this repo; the published one may differ.
  const names = publishedNames(config);
  for (const file of walk(join(outDir, "dist")).filter((f) => /\.(js|d\.ts)$/.test(f))) {
    let text = readFileSync(file, "utf8");
    for (const [from, to] of Object.entries(names)) if (from !== to) text = text.replaceAll(`"${from}"`, `"${to}"`);
    writeFileSync(file, text);
  }

  for (const asset of pkg.assets ?? []) cpSync(join(wsDir, asset), join(outDir, asset), { recursive: true });
  // A missing README or CHANGELOG is reported by checkStaged. {{docs}} in a README is the docs address of packages.json.
  for (const f of ["README.md", "CHANGELOG.md"]) {
    if (existsSync(join(wsDir, f))) writeFileSync(join(outDir, f), readFileSync(join(wsDir, f), "utf8").replaceAll("{{docs}}", config.docs.replace(/\/+$/, "")));
  }
  cpSync(existsSync(join(wsDir, "LICENSE")) ? join(wsDir, "LICENSE") : join(ROOT, "LICENSE"), join(outDir, "LICENSE"));
  writeFileSync(join(outDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main(argv) {
  const config = loadConfig();
  let version = config.version;
  let tsc = true;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--version") version = argv[++i];
    else if (argv[i] === "--skip-tsc") tsc = false;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) throw new Error(`not a version: ${version}`);
  if (tsc) {
    const order = ["shared", ...config.packages.map((p) => p.workspace)];
    // The private repository has an incremental build script; the public copy builds each workspace with tsc.
    if (existsSync(join(ROOT, "scripts/ci/build.sh"))) execFileSync("bash", [join(ROOT, "scripts/ci/build.sh"), "--only", order.join(",")], { stdio: "inherit", cwd: ROOT });
    else for (const ws of order) execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", join("packages", ws, "tsconfig.json")], { stdio: "inherit", cwd: ROOT });
  }
  rmSync(OUT, { recursive: true, force: true });
  let failed = false;
  for (const pkg of config.packages) {
    const dir = join(OUT, pkg.workspace);
    const manifest = await bundle(config, pkg, version, dir);
    const problems = checkStaged(dir, manifest);
    if (problems.length) {
      failed = true;
      console.error(`FAIL ${pkg.name}@${version}:\n  ${problems.join("\n  ")}`);
    } else {
      console.log(`staged ${pkg.name}@${version} in ${relative(ROOT, dir)}`);
    }
  }
  if (failed) process.exit(1);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main(process.argv.slice(2));
