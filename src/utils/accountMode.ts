export function accountModeLabel(mode: number | string | undefined | null): string {
  const numericMode = typeof mode === "string" ? Number(mode) : mode;
  switch (numericMode) {
    case 0:
      return "Backtest";
    case 1:
      return "Binance Live";
    case 2:
      return "Binance Testnet";
    default:
      return mode == null || mode === "" ? "-" : `Mode ${mode}`;
  }
}
