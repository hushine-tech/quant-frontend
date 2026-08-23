export type SingleFlightGuard = {
  tryAcquire: () => boolean;
  release: () => void;
  active: () => boolean;
};

export type RequestGenerationToken = Readonly<{
  identity: string;
  epoch: number;
}>;

export type RequestGenerationOwner = {
  begin: (identity: string) => RequestGenerationToken;
  invalidate: () => void;
  isCurrent: (token: RequestGenerationToken) => boolean;
};

export function createSingleFlightGuard(): SingleFlightGuard {
  let inFlight = false;
  return {
    tryAcquire() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    release() {
      inFlight = false;
    },
    active() {
      return inFlight;
    },
  };
}

export function createRequestGenerationOwner(): RequestGenerationOwner {
  let epoch = 0;
  let current: RequestGenerationToken | null = null;
  return {
    begin(identity: string) {
      epoch += 1;
      current = Object.freeze({ identity, epoch });
      return current;
    },
    invalidate() {
      epoch += 1;
      current = null;
    },
    isCurrent(token: RequestGenerationToken) {
      return current !== null &&
        token.identity === current.identity &&
        token.epoch === current.epoch;
    },
  };
}
