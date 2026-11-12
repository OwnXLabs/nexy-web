// The owner's time zone, as the device reports it (an IANA name such as "Asia/Manila").
// Returns the name, null when none was sent, or throws when it is not a zone this runtime knows.
export function ownerZone(v: unknown): string | null {
  if (v == null || v === "") return null;
  const name = String(v).trim();
  // a name, not an offset: "+08:00" has no clock changes and the agent refuses it
  if (name.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(name)) throw new RangeError(`not a time zone name: ${name.slice(0, 64)}`);
  // Intl throws a RangeError for a name it does not know
  return new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone;
}
