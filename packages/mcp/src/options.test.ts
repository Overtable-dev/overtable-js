import { describe, expect, it } from "vitest";
import { mcpCliOptions } from "./options.js";

describe("overtable-mcp options", () => {
  it("reads OVERTABLE_* first, then RELAIS_*, for every variable", () => {
    const both = mcpCliOptions(["http"], {
      OVERTABLE_URL: "https://new.example",
      RELAIS_URL: "https://old.example",
      OVERTABLE_API_KEY: "new-key",
      RELAIS_API_KEY: "old-key",
      OVERTABLE_MCP_PORT: "5000",
      RELAIS_MCP_PORT: "6000",
      OVERTABLE_MCP_HOST: "0.0.0.0",
      RELAIS_MCP_HOST: "10.0.0.1",
      OVERTABLE_MCP_TOKEN: "new-token",
      RELAIS_MCP_TOKEN: "old-token",
      OVERTABLE_MCP_ALLOWED_HOSTS: "a.example, b.example",
      RELAIS_MCP_ALLOWED_HOSTS: "c.example",
    });
    expect(both).toEqual({
      baseUrl: "https://new.example",
      apiKey: "new-key",
      port: 5000,
      host: "0.0.0.0",
      authToken: "new-token",
      allowedHosts: ["a.example", "b.example"],
    });

    const legacy = mcpCliOptions(["http"], {
      OVERTABLE_URL: "",
      RELAIS_URL: "https://old.example",
      RELAIS_API_KEY: "old-key",
      RELAIS_MCP_PORT: "6000",
      RELAIS_MCP_HOST: "10.0.0.1",
      RELAIS_MCP_TOKEN: "old-token",
      RELAIS_MCP_ALLOWED_HOSTS: "c.example",
    });
    expect(legacy).toEqual({
      baseUrl: "https://old.example",
      apiKey: "old-key",
      port: 6000,
      host: "10.0.0.1",
      authToken: "old-token",
      allowedHosts: ["c.example"],
    });
  });

  it("lets flags win and keeps the defaults when nothing is set", () => {
    expect(mcpCliOptions(["stdio", "--url", "https://flag.example", "--api-key", "flag-key", "--port", "7000"], { OVERTABLE_URL: "https://env.example", OVERTABLE_API_KEY: "env-key" })).toMatchObject({
      baseUrl: "https://flag.example",
      apiKey: "flag-key",
      port: 7000,
    });
    expect(mcpCliOptions(["stdio"], {})).toEqual({
      baseUrl: "http://127.0.0.1:4317",
      apiKey: undefined,
      port: 4318,
      host: "127.0.0.1",
      authToken: undefined,
      allowedHosts: [],
    });
  });
});
