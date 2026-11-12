import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { overtableHome, profilePath } from "./profile.js";

/** Where the CLI keeps its profiles after the rename: ~/.overtable, an existing ~/.relais kept. */
describe("overtable CLI home", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "overtable-home-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("uses ~/.overtable on a new install", () => {
    expect(overtableHome({ HOME: home })).toBe(join(home, ".overtable"));
  });

  it("keeps an existing ~/.relais when ~/.overtable does not exist", () => {
    mkdirSync(join(home, ".relais"));
    expect(overtableHome({ HOME: home })).toBe(join(home, ".relais"));
    expect(profilePath({ HOME: home }, "awa")).toBe(join(home, ".relais", "awa.json"));
  });

  it("uses ~/.overtable when both directories exist", () => {
    mkdirSync(join(home, ".relais"));
    mkdirSync(join(home, ".overtable"));
    expect(overtableHome({ HOME: home })).toBe(join(home, ".overtable"));
  });

  it("prefers OVERTABLE_HOME, then RELAIS_HOME, over both directories", () => {
    mkdirSync(join(home, ".relais"));
    mkdirSync(join(home, ".overtable"));
    expect(overtableHome({ HOME: home, OVERTABLE_HOME: "/new", RELAIS_HOME: "/old" })).toBe("/new");
    expect(overtableHome({ HOME: home, RELAIS_HOME: "/old" })).toBe("/old");
    expect(overtableHome({ HOME: home, OVERTABLE_HOME: " ", RELAIS_HOME: "/old" })).toBe("/old");
  });
});
