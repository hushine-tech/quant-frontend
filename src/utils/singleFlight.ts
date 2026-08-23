export type SingleFlightGuard = {
  tryAcquire: () => boolean;
  release: () => void;
  active: () => boolean;
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
