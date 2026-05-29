export function accountModeLabel(mode: number | string | undefined | null): string {
  const numericMode = typeof mode === "string" ? Number(mode) : mode;
  switch (numericMode) {
    case 0:
      return "Backtest";
    case 1:
      return "Binance Live";
    case 2:
      return "Binance Demo";
    default:
      return mode == null || mode === "" ? "-" : `Mode ${mode}`;
  }
}

export function accountEnvironmentLabel(environment: number | string | undefined | null): string {
  const value = typeof environment === "string" ? Number(environment) : environment;
  switch (value) {
    case 0:
      return "Backtest";
    case 1:
      return "Demo";
    case 2:
      return "Live";
    default:
      return environment == null || environment === "" ? "-" : `Environment ${environment}`;
  }
}
