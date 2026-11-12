#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { run } from "./run.js";
import type { ConnectHooks } from "./connect/index.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function which(command: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const connectHooks: ConnectHooks = {
  which,
  exec: (command, args) => spawnSync(command, args, { stdio: "inherit" }).status ?? 1,
  ...(interactive
    ? {
        ask: async (question: string) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return await rl.question(question);
          } finally {
            rl.close();
          }
        },
        openUrl: (url: string) => {
          const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
          const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
          return spawnSync(opener, args, { stdio: "ignore" }).status === 0;
        },
      }
    : {}),
};

const code = await run(process.argv.slice(2), {
  env: process.env,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readStdin,
  connectHooks,
});
process.exitCode = code;
