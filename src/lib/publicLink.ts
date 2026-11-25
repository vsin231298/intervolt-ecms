import "server-only";

/**
 * Free outside-access link (Cloudflare Quick Tunnel, the "quicklink" service in docker-compose.yml).
 * The address is random and changes when the tunnel restarts, so we read the current one from
 * cloudflared's local metrics endpoint and show it in the app. Returns null when the service isn't running.
 */
export async function currentPublicLink(): Promise<string | null> {
  const base = process.env.QUICKLINK_METRICS_URL ?? "http://quicklink:2000";
  try {
    const res = await fetch(`${base}/quicktunnel`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const data = (await res.json()) as { hostname?: string };
    return data.hostname ? `https://${data.hostname}` : null;
  } catch {
    return null;
  }
}
