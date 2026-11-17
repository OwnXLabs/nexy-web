// Stand-ins for browser APIs newer than the oldest engine Nexy runs in: Android WebView 91 (the
// phone app) and Safari 15. The build transpiles syntax only; a missing API throws at run time
// (Array.prototype.at, for one). tests/old-browsers.test.ts
// keeps the newer ones out of the bundle.

/** The last item, or undefined: `xs.at(-1)` without Array.prototype.at (Chrome 92). */
export const last = <T>(xs: ArrayLike<T>): T | undefined => (xs.length ? xs[xs.length - 1] : undefined);

/** AbortSignal.timeout (Chrome 103, Safari 16) from a controller and a timer. */
export function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// noVNC (the agent's screen) reads Uint8Array.at in its decoders. It ships as published, so the
// method is supplied on typed arrays only; Nexy's own code stays off .at (tests/old-browsers.test.ts).
const typed = Object.getPrototypeOf(Int8Array.prototype) as { at?: unknown };
if (!("at" in typed)) Object.defineProperty(typed, "at", {
  configurable: true, writable: true,
  value(this: ArrayLike<unknown>, i: number) {
    const n = Math.trunc(i) || 0, k = n < 0 ? this.length + n : n;
    return k < 0 || k >= this.length ? undefined : this[k];
  },
});
