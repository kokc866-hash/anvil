/** Rough tokenizer: ~4 chars per token. Good enough for a live context bar. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export const CONTEXT_MAX = 2_097_152;
export const CONTEXT_MIN = 2048;
/** Chip-Werte. 128k/256k/1M wie Katalog, nicht 128×1024. */
export const CONTEXT_SIZES = [4096, 8192, 16384, 32768, 65536, 128_000, 256_000, 1_048_576] as const;

const CONTEXT_LABEL: Record<number, string> = {
  4096: "4k",
  8192: "8k",
  16384: "16k",
  32768: "32k",
  65536: "64k",
  128_000: "128k",
  131_072: "128k",
  256_000: "256k",
  262_144: "256k",
  272_000: "272k",
  1_000_000: "1M",
  1_048_576: "1M",
  1_050_000: "1M",
  2_097_152: "2M",
};

export function matchingContextChip(n: number): number | null {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  for (const s of CONTEXT_SIZES) {
    if (x === s) return s;
  }
  for (const s of CONTEXT_SIZES) {
    if (Math.abs(x - s) / s <= 0.03) return s;
  }
  return null;
}

export function formatContext(n: number): string {
  const chip = matchingContextChip(n);
  if (chip && CONTEXT_LABEL[chip]) return CONTEXT_LABEL[chip];
  if (CONTEXT_LABEL[n]) return CONTEXT_LABEL[n];
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

export function clampContext(n: number): number {
  const x = Math.round(Number(n) || 32768);
  return Math.min(CONTEXT_MAX, Math.max(CONTEXT_MIN, x));
}
