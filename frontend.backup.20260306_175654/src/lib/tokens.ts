const TOKEN_SYMBOLS: Record<string, string> = {
  "strk": "STRK",
  "eth": "ETH",
  "usdc": "USDC",
  "btc": "BTC",
  "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": "ETH",
  "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": "STRK",
};

export function resolveTokenSymbol(value: string): string {
  if (!value) {
    return "--";
  }

  const lower = value.toLowerCase().trim();
  if (TOKEN_SYMBOLS[lower]) {
    return TOKEN_SYMBOLS[lower];
  }

  if (lower.startsWith("0x") && lower.length > 10) {
    return `${lower.slice(0, 6)}...${lower.slice(-4)}`.toUpperCase();
  }

  return value.slice(0, 12).toUpperCase();
}
