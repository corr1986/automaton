/**
 * Profit Gate
 *
 * Replication is allowed only after the automaton has doubled its initial
 * capital (Conway credits + on-chain USDC). The baseline is recorded once,
 * at first boot, and never overwritten.
 */

import type { ToolContext } from "../types.js";

export const INITIAL_CAPITAL_KEY = "initial_capital_cents";

type GateContext = Pick<ToolContext, "identity" | "config" | "db" | "conway">;

export interface ProfitGateResult {
  allowed: boolean;
  currentCents: number;
  requiredCents: number;
}

async function getCapitalCents(ctx: GateContext): Promise<number> {
  const { getUsdcBalance } = await import("../conway/x402.js");
  const chainType = ctx.config.chainType || ctx.identity.chainType || "evm";
  const network = chainType === "solana" ? "solana:mainnet" : "eip155:8453";
  const credits = await ctx.conway.getCreditsBalance();
  const usdc = await getUsdcBalance(ctx.identity.address, network, chainType);
  return credits + Math.round(usdc * 100);
}

/** Baseline in cents, or 0 when not recorded yet (a zero baseline counts as unrecorded). */
function getBaselineCents(ctx: GateContext): number {
  const stored = Number(ctx.db.getKV(INITIAL_CAPITAL_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
}

/** Store the current capital as baseline if none is stored yet and the wallet is funded. */
export async function recordInitialCapital(ctx: GateContext): Promise<void> {
  if (getBaselineCents(ctx) > 0) return;
  const currentCents = await getCapitalCents(ctx);
  if (currentCents > 0) ctx.db.setKV(INITIAL_CAPITAL_KEY, String(currentCents));
}

/** Allowed only when current capital >= 2x the recorded baseline. */
export async function checkProfitGate(ctx: GateContext): Promise<ProfitGateResult> {
  const currentCents = await getCapitalCents(ctx);
  const baselineCents = getBaselineCents(ctx);
  if (baselineCents === 0) {
    if (currentCents > 0) ctx.db.setKV(INITIAL_CAPITAL_KEY, String(currentCents));
    return { allowed: false, currentCents, requiredCents: currentCents * 2 };
  }
  const requiredCents = baselineCents * 2;
  return { allowed: currentCents >= requiredCents, currentCents, requiredCents };
}
