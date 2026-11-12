#!/usr/bin/env node
// The release dry run (docs/publishing.md): what the release workflow does before it publishes, without
// publishing. For every package of scripts/publish/packages.json:
//   1. stage it (scripts/publish/build.mjs) and `npm pack` it;
//   2. install the tarball, with the tarballs of its sibling packages, in an empty folder outside the repository;
//   3. run every quickstart of its README as installed (the blocks after `<!-- quickstart -->`), word for word,
//      against a throwaway local relay (scripts/publish/local-relay.mjs), with OVERTABLE_URL and
//      OVERTABLE_API_KEY set and HOME in the temporary folder;
//   4. import every package from a TypeScript file and compile it (strict, NodeNext, lib check on).
//
//   node scripts/publish/dry-run.mjs                     build everything, then check
//   node scripts/publish/dry-run.mjs --skip-tsc          the workspaces' dist/ is already built: stage only
//   node scripts/publish/dry-run.mjs --skip-build        the workspaces' dist/ and .publish/ are already built
//   node scripts/publish/dry-run.mjs --version 0.2.0     stage another version
//   node scripts/publish/dry-run.mjs --keep              keep the temporary folder, print its path
//   node scripts/publish/dry-run.mjs --no-relay          no local relay and no quickstarts: pack, install outside the
//                                                        checkout and type-check only. The public repository of the
//                                                        packages has no relay; the quickstarts ran here before the copy
//   node scripts/publish/dry-run.mjs --from-registry [v] the weekly check: install <name>@<v> (default latest) from
//                                                        the npm registry instead of the tarballs, then the same quickstarts
//
// Third-party dependencies come from the npm registry; the packages themselves only from the tarballs.
// Exit code 0 only when every package packed, installed and ran every quickstart.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OUT, loadConfig, publishedNames } from "./build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The quickstart blocks of a README: the fenced block right after each `<!-- quickstart -->` line. */
export function quickstarts(readme) {
  const blocks = [];
  const re = /<!--\s*quickstart\s*-->\s*\n```(\w+)[^\n]*\n([\s\S]*?)\n```/g;
  for (const m of readme.matchAll(re)) blocks.push({ lang: m[1], code: m[2] });
  return blocks;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}` };
}

function indent(text) {
  return text
    .trimEnd()
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

async function startRelay(work) {
  const state = join(work, "relay.json");
  const child = spawn(process.execPath, [join(ROOT, "scripts/publish/local-relay.mjs"), state], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test" },
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120 && !existsSync(state); i += 1) {
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!existsSync(state)) {
    child.kill("SIGTERM");
    throw new Error(`the local relay did not start:\n${log}`);
  }
  await new Promise((r) => setTimeout(r, 200)); // the file is written in one call; let it land
  return { child, ...JSON.parse(readFileSync(state, "utf8")) };
}

async function main(argv) {
  let build = true;
  let tsc = true;
  let keep = false;
  let version;
  let registry = null;
  let relayRun = true;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--skip-build") build = false;
    else if (argv[i] === "--skip-tsc") tsc = false;
    else if (argv[i] === "--from-registry") registry = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "latest";
    else if (argv[i] === "--keep") keep = true;
    else if (argv[i] === "--no-relay") relayRun = false;
    else if (argv[i] === "--version") version = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  const config = loadConfig();
  const names = publishedNames(config);

  if (build && tsc) {
    // The packages, and what the local relay needs: relay and conformance (its in-process bootstrap).
    const tsc = relayRun
      ? run("bash", [join(ROOT, "scripts/ci/build.sh"), "--only", "shared,relay,verify,schemas,sdk,mcp,cli,conformance"], { cwd: ROOT, stdio: "inherit" })
      : run(process.execPath, [join(ROOT, "scripts/publish/build.mjs"), ...(version ? ["--version", version] : [])], { cwd: ROOT, stdio: "inherit" });
    if (tsc.code !== 0) throw new Error("tsc build failed");
  }
  if (build && !registry && (relayRun || !tsc)) {
    const staged = run(process.execPath, [join(ROOT, "scripts/publish/build.mjs"), "--skip-tsc", ...(version ? ["--version", version] : [])], { cwd: ROOT, stdio: "inherit" });
    if (staged.code !== 0) throw new Error("staging failed");
  }

  const base = process.env.RUNNER_TEMP || tmpdir();
  const work = mkdtempSync(join(base, "overtable-dry-run-"));
  if (!relative(ROOT, work).startsWith("..")) throw new Error(`the dry run folder ${work} is inside the repository`);
  const tarballs = join(work, "tarballs");
  mkdirSync(tarballs);

  const results = [];
  const tarballOf = {};
  for (const pkg of registry ? [] : config.packages) {
    const packed = run("npm", ["pack", "--json", "--pack-destination", tarballs], { cwd: join(OUT, pkg.workspace) });
    if (packed.code !== 0) {
      results.push({ name: pkg.name, ok: false, detail: `npm pack failed:\n${indent(packed.out)}` });
      continue;
    }
    const info = JSON.parse(packed.out.slice(packed.out.indexOf("[")))[0];
    tarballOf[pkg.name] = join(tarballs, info.filename);
    console.log(`packed ${info.id}: ${info.entryCount} files, ${(info.size / 1024).toFixed(1)} kB (${info.files.map((f) => f.path).join(", ")})`);
  }

  const relay = relayRun ? await startRelay(work) : null;
  if (relay) console.log(`local relay on ${relay.url}`);
  else console.log("no local relay: install and type-check only (--no-relay)");
  try {
    for (const pkg of config.packages) {
      if (!registry && !tarballOf[pkg.name]) continue;
      const dir = join(work, pkg.workspace);
      const home = join(dir, "home");
      mkdirSync(home, { recursive: true });
      writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: `dry-run-${pkg.workspace}`, private: true, type: "module" }, null, 2)}\n`);
      // The package and its siblings from the tarballs (none of them is on the registry before the first
      // publication), or, for the weekly check, the package alone from the registry.
      const siblings = pkg.dependencies.filter((d) => names[d]).map((d) => tarballOf[names[d]]);
      const specs = registry ? [`${pkg.name}@${registry}`] : [tarballOf[pkg.name], ...siblings];
      const install = run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", ...specs], { cwd: dir, env: { ...process.env, HOME: home } });
      if (install.code !== 0) {
        results.push({ name: pkg.name, ok: false, detail: `npm install failed:\n${indent(install.out)}` });
        continue;
      }
      const readme = readFileSync(join(dir, "node_modules", ...pkg.name.split("/"), "README.md"), "utf8");
      const blocks = quickstarts(readme);
      if (!relay) {
        results.push({ name: pkg.name, ok: blocks.length > 0, detail: blocks.length > 0 ? `  installed outside the checkout; ${blocks.length} quickstart(s) not run (--no-relay)` : "its README has no quickstart" });
        continue;
      }
      if (blocks.length === 0) {
        results.push({ name: pkg.name, ok: false, detail: "its README has no quickstart" });
        continue;
      }
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        CODEX_HOME: join(home, ".codex"),
        OVERTABLE_URL: relay.url,
        OVERTABLE_API_KEY: relay.apiKey,
        LANG: "en_US.UTF-8",
        npm_config_update_notifier: "false",
      };
      const lines = [];
      let ok = true;
      blocks.forEach((block, i) => {
        let r;
        if (block.lang === "sh" || block.lang === "bash") {
          r = run("bash", ["-eo", "pipefail", "-c", block.code], { cwd: dir, env, timeout: 120_000 });
        } else if (block.lang === "js" || block.lang === "ts" || block.lang === "mjs") {
          const file = join(dir, `quickstart-${i + 1}.mjs`);
          writeFileSync(file, `${block.code}\n`);
          r = run(process.execPath, [file], { cwd: dir, env, timeout: 120_000 });
        } else {
          r = { code: 1, out: `a quickstart in ${block.lang} cannot run here` };
        }
        // Never print the bot's key, whatever a quickstart echoes.
        const out = r.out.replaceAll(relay.apiKey, "<api key>");
        ok &&= r.code === 0;
        lines.push(`  quickstart ${i + 1} (${block.lang}): ${r.code === 0 ? "ok" : `exit ${r.code}`}\n${indent(out || "(no output)")}`);
      });
      results.push({ name: pkg.name, ok, detail: lines.join("\n") });
    }
  } finally {
    relay?.child.kill("SIGTERM");
  }

  // Types: every package imported by name from a TypeScript file, compiled with the repository's tsc in strict
  // NodeNext mode without skipLibCheck, so the bundled .d.ts files are checked too.
  {
    const dir = join(work, "types");
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "dry-run-types", private: true, type: "module" }, null, 2)}\n`);
    const specs = registry ? config.packages.map((p) => `${p.name}@${registry}`) : config.packages.map((p) => tarballOf[p.name]).filter(Boolean);
    const install = run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", ...specs, "@types/node@22"], { cwd: dir, env: { ...process.env, HOME: join(dir, "home") } });
    const imports = config.packages.map((p, i) => `import * as p${i} from "${p.name}";`).join("\n");
    writeFileSync(join(dir, "check.ts"), `${imports}\nexport const all = [${config.packages.map((_, i) => `p${i}`).join(", ")}];\n`);
    const tsc = install.code === 0
      ? run(join(ROOT, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", "--types", "node", "check.ts"], { cwd: dir })
      : install;
    results.push({ name: "types (every package from TypeScript, strict, NodeNext, lib check on)", ok: tsc.code === 0, detail: tsc.code === 0 ? "  tsc: ok" : indent(tsc.out) });
  }

  console.log("");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}\n${r.detail}\n`);
  const failed = results.filter((r) => !r.ok).length + config.packages.filter((p) => !results.some((r) => r.name === p.name)).length;
  const how = registry ? `installed from the npm registry (${registry})` : "packed, installed outside the repository";
  const ran = relayRun ? "ran their quickstarts and type-check" : "type-check (quickstarts not run: --no-relay)";
  console.log(failed === 0 ? `dry run: ${config.packages.length} of ${config.packages.length} packages ${how}, ${ran}` : `dry run: ${failed} check(s) failed`);
  if (keep) console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
  process.exitCode = failed === 0 ? 0 : 1;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main(process.argv.slice(2));
