// Remove anything that looks like a key, token, password or cookie from text that may leave the
// device. Runs in the browser (the preview) and again on the server (the send); applying it twice
// changes nothing, so what was previewed is what is sent.
const R = "[removed]";
const HEADER = /\b(set-cookie|cookie|authorization|proxy-authorization)(\s*:\s*)[^\n]+/gi;
const SCHEME = /\b(bearer|basic|token)\s+(?!\[removed\])[A-Za-z0-9._~+/=-]{8,}/gi;
const NAMED = /([A-Za-z0-9_.-]*(?:token|secret|passwd|password|pwd|cookie|auth|credential|session|signature|key)s?)(\\?["']?\s*[:=]\s*\\?["']?)(?!\[removed\])[^\s"'&,;}\]\\]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
// a wallet address or private key: 0x and 40 or more hex digits
const WALLET = /\b0x[0-9a-fA-F]{40,}\b/g;
const LONG = /[A-Za-z0-9_+=-]{32,}/g;

export function scrub(s: string): string {
  return s
    .replace(JWT, R)
    .replace(WALLET, R)
    .replace(HEADER, `$1$2${R}`)
    .replace(SCHEME, `$1 ${R}`)
    .replace(NAMED, `$1$2${R}`)
    // a long run of letters and digits together is likely a key; plain long words are left alone
    .replace(LONG, (t) => (/\d/.test(t) && /[A-Za-z]/.test(t) ? R : t));
}

// Logs, errors and a shared conversation also lose what points at a person or a machine: email
// addresses, phone numbers, the user name in home folders, IP addresses (loopback kept, it names
// nothing) and hardware (MAC) addresses. No lookbehind: Safari 15 has none.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = /(^|[^\w+.:/-])(\+\d{1,3}[ .-]?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]?\d{2,4}){1,4}|\(\d{3}\) ?\d{3}[ .-]\d{4}|\d{3}[.-]\d{3}[.-]\d{4})(?![\w.:-])/g;
const HOME = /(\/Users\/|\/home\/|[A-Za-z]:[\\/]Users[\\/])(?!\[user\])(?:[^/\\\s"'<>:]+(?: [^/\\\s"'<>:]+)*(?=[/\\])|[^/\\\s"'<>:]+)/gi;
const MAC = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const IPV4 = /\b(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const IPV6 = /(^|[^\w:])((?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4})(?![\w:])/g;

export function scrubLog(s: string): string {
  return scrub(s)
    .replace(EMAIL, R)
    .replace(MAC, R)
    .replace(IPV6, (_m, pre: string) => `${pre}${R}`)
    .replace(PHONE, (_m, pre: string) => `${pre}${R}`)
    .replace(HOME, (_m, dir: string) => `${dir}[user]`)
    .replace(IPV4, (m, a: string) => (a === "127" || m === "0.0.0.0" ? m : R));
}

// an address without its query string or fragment (they can carry keys or chat ids)
export const bareUrl = (u: string): string => scrub(u.split(/[?#]/)[0]);
