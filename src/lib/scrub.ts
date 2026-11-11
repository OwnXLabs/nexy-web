// Remove anything that looks like a key, token, password or cookie from text that may leave the
// device. Runs in the browser (the preview) and again on the server (the send); applying it twice
// changes nothing, so what was previewed is what is sent.
const R = "[removed]";
const HEADER = /\b(set-cookie|cookie|authorization|proxy-authorization)(\s*:\s*)[^\n]+/gi;
const SCHEME = /\b(bearer|basic|token)\s+(?!\[removed\])[A-Za-z0-9._~+/=-]{8,}/gi;
const NAMED = /([A-Za-z0-9_.-]*(?:token|secret|passwd|password|pwd|cookie|auth|credential|session|signature|key)s?)(\\?["']?\s*[:=]\s*\\?["']?)(?!\[removed\])[^\s"'&,;}\]\\]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const LONG = /[A-Za-z0-9_+=-]{32,}/g;

export function scrub(s: string): string {
  return s
    .replace(JWT, R)
    .replace(HEADER, `$1$2${R}`)
    .replace(SCHEME, `$1 ${R}`)
    .replace(NAMED, `$1$2${R}`)
    // a long run of letters and digits together is likely a key; plain long words are left alone
    .replace(LONG, (t) => (/\d/.test(t) && /[A-Za-z]/.test(t) ? R : t));
}

// an address without its query string or fragment (they can carry keys or chat ids)
export const bareUrl = (u: string): string => scrub(u.split(/[?#]/)[0]);
