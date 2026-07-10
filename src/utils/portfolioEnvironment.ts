export function portfolioEnvironmentLabel(environment: number | string | undefined | null): string {
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
