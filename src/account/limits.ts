export class KimiLimitError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = 'KimiLimitError';
    this.status = status;
    this.body = body;
  }
}

const LIMIT_PATTERNS: RegExp[] = [
  /rate[_\s-]?limit/i,
  /quota/i,
  /exceed/i,
  /limit[_\s-]?reach/i,
  /too many requests/i,
  /usage[_\s-]?limit/i,
  /not enough/i,
  /insufficient/i,
  /frequency/i,
  /throttl/i,
  /subscribe/i,
  /membership/i,
  /upgrade.*(plan|member|pro)/i,
  /out of (credit|quota|usage)/i,
  /daily limit/i,
  /monthly limit/i,
  /request limit/i,
  /traffic limit/i,
  /请求过于频繁/,
  /额度/,
  /次数/,
  /上限/,
  /会员/,
  /限流/,
  /esgotad/i,
  /limite (atingido|excedido|diário|diario)/i,
  /sem (cota|crédito|credito)/i,
  /usage_limit/i,
  /RESOURCE_EXHAUSTED/i,
  /PERMISSION_DENIED/i,
  /exceeded_current_quota/i,
  /engine_overloaded/i,
];

export function isLimitStatus(status: number): boolean {
  return status === 429 || status === 402 || status === 403 || status === 451;
}

export function textLooksLikeLimit(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 8000);
  return LIMIT_PATTERNS.some((re) => re.test(sample));
}

export function assertNotLimitResponse(status: number, bodyText: string): void {
  if (isLimitStatus(status) || textLooksLikeLimit(bodyText)) {
    throw new KimiLimitError(
      `Kimi account limit/quota detected (HTTP ${status}): ${bodyText.slice(0, 400)}`,
      status,
      bodyText
    );
  }
}

export function errorLooksLikeLimit(err: unknown): boolean {
  if (err instanceof KimiLimitError) return true;
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return textLooksLikeLimit(msg) || /Failed to fetch from Kimi: (429|402|403)/i.test(msg);
}
