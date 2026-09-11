import api from "./client";

export type ShellBalance = { display: string; exact: string | null };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid economy summary");
  return value as Record<string, unknown>;
}

export function parseCreditSummary(value: unknown): number {
  const total = record(value).credit_total;
  // Credit is the Agent's accumulated total, never consumable/spendable credit.
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) throw new Error("Invalid credit total");
  return total;
}

export function parseShellSummary(value: unknown): ShellBalance {
  const summary = record(value);
  if (summary.shell_balance_display !== undefined || summary.shell_balance_exact !== undefined) {
    const display = summary.shell_balance_display, exact = summary.shell_balance_exact;
    if (typeof display !== "string" || !/^\d{1,128}\.\d{2}$/.test(display)
      || typeof exact !== "string" || !/^\d{1,128}(?:\/[1-9]\d{0,127})?$/.test(exact)) throw new Error("Invalid shell balance");
    // Preserve the server's decimal display and exact fraction; never parseFloat fractions.
    return { display, exact };
  }
  // The currently deployed legacy API reports whole shells only. Do not invent decimals.
  const balance = summary.shell_balance;
  if (typeof balance !== "number" || !Number.isSafeInteger(balance) || balance < 0) throw new Error("Invalid shell balance");
  return { display: String(balance), exact: null };
}

export function groupShellDisplay(display: string): string {
  const [whole, fraction] = display.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
}

export function compactEconomyDisplay(display: string, unit = "萬"): string {
  if (!/^\d{1,128}(?:\.\d{1,2})?$/.test(display)) throw new Error("Invalid economy display");
  const whole = BigInt(display.split(".")[0]);
  if (whole < 10000n) return groupShellDisplay(display);
  // Keep one decimal in units of ten thousand, truncated rather than inflated.
  // Decimal/fractional wallet values never pass through floating-point arithmetic.
  const tenths = whole / 1000n;
  const remainder = tenths % 10n;
  return `${groupShellDisplay(String(tenths / 10n))}${remainder ? `.${remainder}` : ""}${unit}`;
}

export function economyNeedsAgent(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null)?.response;
  return response?.status === 403 && response.data?.detail === "需要先領養室友";
}

export async function getAgentCredit(signal: AbortSignal): Promise<number> {
  return parseCreditSummary((await api.get("/credit/summary", { signal, timeout: 15000 })).data);
}

export async function getAgentShells(signal: AbortSignal): Promise<ShellBalance> {
  // /shell/summary is the Agent wallet, not the human garden market wallet.
  return parseShellSummary((await api.get("/shell/summary", { signal, timeout: 15000 })).data);
}
