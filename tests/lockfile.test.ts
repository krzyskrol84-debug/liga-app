import { describe, expect, it } from "vitest";
import { createBasicAuthHeader, LeagueLockfileError, parseLeagueLockfile } from "../src-node/league/lockfile";

describe("League lockfile parser", () => {
  it("parses a valid League Client lockfile", () => {
    const result = parseLeagueLockfile("LeagueClient:1234:2999:test-password:https");

    expect(result).toEqual({
      processName: "LeagueClient",
      pid: 1234,
      port: 2999,
      password: "test-password",
      protocol: "https",
    });
  });

  it("rejects invalid lockfile format", () => {
    expect(() => parseLeagueLockfile("broken")).toThrow(LeagueLockfileError);
  });

  it("creates a Basic Auth header for LCU", () => {
    expect(createBasicAuthHeader("riot", "secret")).toBe("Basic cmlvdDpzZWNyZXQ=");
  });
});
