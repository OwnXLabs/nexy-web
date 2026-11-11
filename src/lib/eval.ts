// Eval mode switches to a shared test engine and shared test files, so it is off unless the server
// was started for evals (NEXY_EVAL=1); a request alone (header, query or body) cannot turn it on.
export const evalAllowed = (): boolean => process.env.NEXY_EVAL === "1";
export const wantsEval = (asked: boolean): boolean => asked && evalAllowed();
