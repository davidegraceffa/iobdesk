/** Fusi orari IANA disponibili nel browser, con ripiego su un elenco minimo. */
export function listTimezones(extra: Array<string | undefined> = []): string[] {
  let zones: string[];
  try {
    zones =
      (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = [
      'UTC',
      'Europe/Rome',
      'Europe/London',
      'Europe/Berlin',
      'America/New_York',
      'America/Los_Angeles',
      'Asia/Tokyo',
    ];
  }
  const all = new Set(zones);
  for (const z of extra) if (z) all.add(z);
  return [...all].sort();
}
