/**
 * Children must clone the fork (which carries the profit gate), and the
 * replication code must be protected from self-modification.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { spawnChild } from "../replication/spawn.js";
import { isProtectedFile } from "../self-mod/code.js";
import { MockConwayClient, createTestDb, createTestIdentity } from "./mocks.js";
import type { GenesisConfig } from "../types.js";

const FORK_URL = "https://github.com/corr1986/automaton.git";
const UPSTREAM_URL = "https://github.com/Conway-Research/automaton.git";

describe("children clone the fork", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("spawnChild clones the fork repository", async () => {
    const conway = new MockConwayClient();
    const identity = createTestIdentity();
    const genesis: GenesisConfig = {
      name: "fork-child",
      genesisPrompt: "test",
      creatorAddress: identity.address,
      parentAddress: identity.address,
    };
    const commands: string[] = [];
    vi.spyOn(conway, "exec").mockImplementation(async (command: string) => {
      commands.push(command);
      if (command.includes("--init")) {
        return {
          stdout: "Wallet initialized: 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });

    await spawnChild(conway, identity, createTestDb(), genesis);

    const clone = commands.find((c) => c.includes("git clone"));
    expect(clone).toContain(FORK_URL);
  });

  it("no spawn path references the upstream repository", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../replication/spawn.ts", import.meta.url)),
      "utf-8",
    );
    expect(src).not.toContain(UPSTREAM_URL);
  });
});

describe("replication code is protected", () => {
  it.each([
    "src/replication/spawn.ts",
    "dist/replication/spawn.js",
    "src/replication/profit-gate.ts",
    "dist/replication/profit-gate.js",
  ])("%s is protected", (file) => {
    expect(isProtectedFile(file)).toBe(true);
  });
});
