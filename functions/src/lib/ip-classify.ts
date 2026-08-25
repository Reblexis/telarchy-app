// Classify a visitor IP as a real person vs a server/bot (owner ask
// 2026-08-11). The user-agent filter already drops obvious crawlers; this
// adds the stronger signal: whether the IP itself belongs to a hosting /
// datacenter provider (what a headless bot spoofing a browser UA uses) or
// a proxy/VPN, versus a residential/mobile ISP (a real person).
//
// Runs only on the admin /floor-stats read (never on the public floor
// path), so a batch lookup against a free geo-IP service is acceptable.
// Results are cached in-process for an hour so repeated admin loads do not
// re-query, and any failure degrades to 'unknown' rather than erroring.

export type IpKind = 'person' | 'server' | 'proxy' | 'unknown';
export interface IpInfo {
  kind: IpKind;
  org: string;
}

/** Pure mapping from an ip-api row to our label; unit-tested. */
export function classifyRow(row: {
  status?: string;
  hosting?: boolean;
  proxy?: boolean;
  mobile?: boolean;
  org?: string;
  as?: string;
}): IpInfo {
  if (!row || row.status !== 'success') return { kind: 'unknown', org: '' };
  const org = (row.org || row.as || '').slice(0, 80);
  if (row.hosting) return { kind: 'server', org }; // datacenter / cloud = a bot or server
  if (row.proxy) return { kind: 'proxy', org }; // VPN / anonymizer
  return { kind: 'person', org }; // residential / mobile ISP
}

const cache = new Map<string, { info: IpInfo; at: number }>();
const TTL_MS = 60 * 60 * 1000;
const cleanIp = (ip: string) => ip.split(',')[0].trim();

export async function classifyIps(ips: string[]): Promise<Map<string, IpInfo>> {
  const out = new Map<string, IpInfo>();
  const now = Date.now();
  const need: string[] = [];
  for (const raw of ips) {
    const ip = cleanIp(raw);
    if (!ip) continue;
    const c = cache.get(ip);
    if (c && now - c.at < TTL_MS) out.set(raw, c.info);
    else need.push(raw);
  }
  for (let i = 0; i < need.length; i += 100) {
    const batch = need.slice(i, i + 100);
    try {
      const res = await fetch('http://ip-api.com/batch?fields=status,query,hosting,proxy,mobile,org,as', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map(cleanIp)),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`ip-api ${res.status}`);
      const rows = (await res.json()) as Array<Parameters<typeof classifyRow>[0]>;
      rows.forEach((row, idx) => {
        const info = classifyRow(row);
        cache.set(cleanIp(batch[idx]), { info, at: now });
        out.set(batch[idx], info);
      });
    } catch (e) {
      console.error('ip classify failed:', (e as Error).message);
      for (const ip of batch) if (!out.has(ip)) out.set(ip, { kind: 'unknown', org: '' });
    }
  }
  return out;
}
