import { describe, expect, it } from "vitest";
import { brandedEnv, brandedEnvName } from "./env.js";

describe("brandedEnv", () => {
  it("prefers OVERTABLE_, falls back to RELAIS_, and treats empty as unset", () => {
    expect(brandedEnv({ OVERTABLE_URL: "https://a", RELAIS_URL: "https://b" }, "URL")).toBe("https://a");
    expect(brandedEnvName({ OVERTABLE_URL: "https://a", RELAIS_URL: "https://b" }, "URL")).toBe("OVERTABLE_URL");
    expect(brandedEnv({ RELAIS_URL: "https://b" }, "URL")).toBe("https://b");
    expect(brandedEnvName({ RELAIS_URL: "https://b" }, "URL")).toBe("RELAIS_URL");
    // docker compose forwards both names; an empty one must not hide the other.
    expect(brandedEnv({ OVERTABLE_URL: "", RELAIS_URL: "https://b" }, "URL")).toBe("https://b");
    expect(brandedEnv({ OVERTABLE_URL: "  " }, "URL")).toBeUndefined();
    expect(brandedEnv({}, "URL")).toBeUndefined();
    expect(brandedEnvName({}, "URL")).toBe("OVERTABLE_URL");
  });
});
