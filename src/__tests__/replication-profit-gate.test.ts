/**
 * Profit gate: replication is allowed only after the agent has doubled
 * its initial capital (credits + USDC).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const usdcBalance = vi.hoisted(() => ({ value: 0 }));

vi.mock("../conway/x402.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../conway/x402.js")>();
  return {
    ...actual,
    getUsdcBalance: vi.fn(async () => usdcBalance.value),
  };
});

vi.mock("../registry/erc8004.js", () => ({
  queryAgent: vi.fn(),
  getTotalAgents: vi.fn().mockResolvedValue(0),
  registerAgent: vi.fn(),
  leaveFeedback: vi.fn(),
}));

import { createBuiltinTools } from "../agent/tools.js";
import {
  recordInitialCapital,
  checkProfitGate,
  INITIAL_CAPITAL_KEY,
} from "../replication/profit-gate.js";
import {
  MockInferenceClient,
  MockConwayClient,
  createTestDb,
  createTestIdentity,
  createTestConfig,
} from "./mocks.js";
import type { AutomatonDatabase, ToolContext } from "../types.js";

describe("profit gate", () => {
  let db: AutomatonDatabase;
  let conway: MockConwayClient;
  let ctx: ToolContext;

  beforeEach(() => {
    db = createTestDb();
    conway = new MockConwayClient();
    usdcBalance.value = 0;
    ctx = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway,
      inference: new MockInferenceClient(),
    };
  });

  afterEach(() => {
    db.close();
  });

  it("recordInitialCapital stores credits + USDC in cents", async () => {
    conway.creditsCents = 1500;
    usdcBalance.value = 5; // $5
    await recordInitialCapital(ctx);
    expect(db.getKV(INITIAL_CAPITAL_KEY)).toBe("2000");
  });

  it("recordInitialCapital never overwrites an existing value", async () => {
    db.setKV(INITIAL_CAPITAL_KEY, "2000");
    conway.creditsCents = 100;
    await recordInitialCapital(ctx);
    expect(db.getKV(INITIAL_CAPITAL_KEY)).toBe("2000");
  });

  it("blocks when capital is below 2x initial", async () => {
    db.setKV(INITIAL_CAPITAL_KEY, "2000");
    conway.creditsCents = 2500;
    usdcBalance.value = 14.99;
    const gate = await checkProfitGate(ctx);
    expect(gate.allowed).toBe(false);
    expect(gate.requiredCents).toBe(4000);
    expect(gate.currentCents).toBe(3999);
  });

  it("allows when capital reaches 2x initial", async () => {
    db.setKV(INITIAL_CAPITAL_KEY, "2000");
    conway.creditsCents = 2500;
    usdcBalance.value = 15;
    const gate = await checkProfitGate(ctx);
    expect(gate.allowed).toBe(true);
  });

  it("records the baseline and blocks when no initial capital is stored", async () => {
    conway.creditsCents = 2000;
    const gate = await checkProfitGate(ctx);
    expect(gate.allowed).toBe(false);
    expect(db.getKV(INITIAL_CAPITAL_KEY)).toBe("2000");
  });

  it("does not record a zero baseline (wallet not funded yet)", async () => {
    conway.creditsCents = 0;
    await recordInitialCapital(ctx);
    expect(db.getKV(INITIAL_CAPITAL_KEY)).toBeUndefined();
  });

  it("treats a zero baseline as unrecorded and blocks", async () => {
    db.setKV(INITIAL_CAPITAL_KEY, "0");
    conway.creditsCents = 2000;
    const gate = await checkProfitGate(ctx);
    expect(gate.allowed).toBe(false);
    expect(db.getKV(INITIAL_CAPITAL_KEY)).toBe("2000");
  });

  it("blocks with zero capital and no baseline", async () => {
    conway.creditsCents = 0;
    const gate = await checkProfitGate(ctx);
    expect(gate.allowed).toBe(false);
    expect(db.getKV(INITIAL_CAPITAL_KEY)).toBeUndefined();
  });

  it("spawn_child refuses before doubling and creates no sandbox", async () => {
    db.setKV(INITIAL_CAPITAL_KEY, "2000");
    conway.creditsCents = 3000;
    const createSpy = vi.spyOn(conway, "createSandbox");
    const tool = createBuiltinTools("test-sandbox-id").find(
      (t) => t.name === "spawn_child",
    )!;
    const result = await tool.execute({ name: "child-1" }, ctx);
    expect(result).toMatch(/^Blocked:/);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
