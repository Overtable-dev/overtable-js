#!/usr/bin/env node
/**
 * overtable-verify: the offline check of signed Overtable receipts, with the same arguments, lines
 * and exit codes as the relay's `overtable-receipt-verify` (packages/relay/src/receipts/verify-cli.ts).
 *
 *   overtable-verify receipt.json [decision.json ...] [--public-key <spki-base64url>]
 *   overtable-verify overtable-receipts-OT-7F3K.json      (an owner's export, /app/receipts/export.json)
 *
 * Exit codes: 0 every receipt verified, 1 a receipt failed, 2 wrong use or a file that cannot be read.
 */
import { verifyReceiptBundle } from "./bundle.js";
import { RECEIPT_EXPORT_FORMAT, verifyReceiptExport } from "./export.js";
import type { RelayPublicKey } from "./receipts.js";

export interface VerifyCliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readFile: (path: string) => string;
}

function usage(io: VerifyCliIo): void {
  io.stderr("Usage: overtable-verify <receipt.json> [more.json ...] [--public-key <spki-base64url>]\n");
  io.stderr("  Give an agreement with the decision receipts it cites to check each citation.\n");
  io.stderr("  --public-key <key>    require the signature to match this Ed25519 SPKI key (DER, base64url)\n");
}

export function runVerifyCli(argv: readonly string[], io: VerifyCliIo): number {
  const args = [...argv];
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    usage(io);
    return args[0] ? 0 : 2;
  }
  const paths: string[] = [];
  const trustedKeys: RelayPublicKey[] = [];
  while (args.length > 0) {
    const flag = args.shift()!;
    if (!flag.startsWith("--")) {
      paths.push(flag);
      continue;
    }
    if (flag === "--public-key") {
      const key = args.shift();
      if (!key) {
        io.stderr("--public-key needs a value\n");
        return 2;
      }
      trustedKeys.push({ kid: `cli-${trustedKeys.length}`, alg: "Ed25519", publicKey: key });
      continue;
    }
    io.stderr(`Unknown option: ${flag}\n`);
    usage(io);
    return 2;
  }
  const raws: unknown[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = io.readFile(path);
    } catch (err) {
      io.stderr(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
    try {
      raws.push(JSON.parse(text) as unknown);
    } catch {
      io.stderr(`FAIL: bad_format: ${path} is not valid JSON.\n`);
      return 1;
    }
  }
  const options = trustedKeys.length > 0 ? { trustedKeys } : {};
  if (raws.length === 1 && (raws[0] as { format?: unknown } | null)?.format === RECEIPT_EXPORT_FORMAT) {
    const check = verifyReceiptExport(raws[0], options);
    for (const r of check.receipts) {
      (r.ok ? io.stdout : io.stderr)(r.ok ? `OK ${r.id}\n` : `FAIL ${r.id}: ${r.code ?? "invalid"}\n`);
    }
    if (check.ok) {
      io.stdout(`OK: export verified, ${check.receipts.length} receipt(s).\n`);
      return 0;
    }
    io.stderr(`FAIL: ${check.code ?? "invalid"}\n`);
    return 1;
  }
  const result = verifyReceiptBundle(raws, options);
  for (const line of result.lines) {
    (line.startsWith("FAIL") ? io.stderr : io.stdout)(`${line}\n`);
  }
  if (result.ok) {
    io.stdout(paths.length === 1 ? "OK: receipt signature verified.\n" : "OK: every receipt verified.\n");
    return 0;
  }
  return 1;
}
