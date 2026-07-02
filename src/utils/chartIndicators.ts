export type RSIPoint = {
  value: number | null;
};

export type MACDPoint = {
  dif: number;
  dea: number;
  macd: number;
  signal: number;
  histogram: number;
};

function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const result = new Array<number>(values.length);
  result[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    result[i] = (values[i] - result[i - 1]) * multiplier + result[i - 1];
  }
  return result;
}

export function calculateRSI(values: number[], period = 14): RSIPoint[] {
  if (period <= 0) throw new Error("RSI period must be positive");
  const result = values.map<RSIPoint>(() => ({ value: null }));
  if (values.length <= period) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) {
      avgGain += change;
    } else {
      avgLoss -= change;
    }
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < values.length; i += 1) {
    if (i > period) {
      const change = values[i] - values[i - 1];
      const gain = Math.max(change, 0);
      const loss = Math.max(-change, 0);
      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    }
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
    result[i] = { value: rsi };
  }

  return result;
}

export function calculateMACD(values: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MACDPoint[] {
  if (fastPeriod <= 0 || slowPeriod <= 0 || signalPeriod <= 0) {
    throw new Error("MACD periods must be positive");
  }
  if (fastPeriod >= slowPeriod) {
    throw new Error("MACD fast period must be smaller than slow period");
  }
  if (values.length === 0) return [];

  const fastEMA = calculateEMA(values, fastPeriod);
  const slowEMA = calculateEMA(values, slowPeriod);
  const macdLine = values.map((_, index) => fastEMA[index] - slowEMA[index]);
  const signalLine = calculateEMA(macdLine, signalPeriod);

  return macdLine.map((dif, index) => {
    const dea = signalLine[index];
    const histogram = dif - dea;
    return {
      dif,
      dea,
      macd: histogram,
      signal: dea,
      histogram,
    };
  });
}
