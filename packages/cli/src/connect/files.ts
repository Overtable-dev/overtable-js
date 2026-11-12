import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/**
 * Backup of the old file (same mode), then an atomic write (tmp file + rename).
 * Returns the backup path, or null when there was no old file.
 */
export function writeWithBackup(path: string, content: string, now: Date): string | null {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  let backup: string | null = null;
  let mode = 0o600;
  if (existsSync(path)) {
    mode = statSync(path).mode & 0o777;
    backup = `${path}.bak-overtable-${stamp(now)}`;
    writeFileSync(backup, readFileSync(path), { mode });
    chmodSync(backup, mode);
  }
  const tmp = `${path}.tmp-overtable-${process.pid}`;
  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
  return backup;
}

/** A plain copy of the old file, leaving the original untouched. */
export function copyBackup(path: string, now: Date): string {
  const backup = `${path}.bak-overtable-${stamp(now)}`;
  copyFileSync(path, backup);
  chmodSync(backup, statSync(path).mode & 0o777);
  return backup;
}
