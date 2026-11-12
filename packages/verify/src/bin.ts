#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runVerifyCli } from "./cli.js";

process.exitCode = runVerifyCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFileSync(path, "utf8"),
});
