export const DEFAULT_EC2_HOST = '44.242.94.86';

export interface VncOptions {
  scale?: 'fixed' | 'fit';
  host?: string;
  port?: number;
  token?: string;
  protocol?: 'http' | 'https';
  ssl?: boolean;
}

export function getVncPort(displayNumber: number): number {
  return 6079 + displayNumber;
}

export function getVncUrl(
  displayNumber: number,
  optionsOrHost?: VncOptions | string
): string {
  let host = DEFAULT_EC2_HOST;
  let scale: 'fixed' | 'fit' = 'fixed';
  let customPort: number | undefined;
  let customToken: string | undefined;
  let protocol: 'http' | 'https' = 'http';

  if (typeof optionsOrHost === 'string') {
    host = optionsOrHost;
  } else if (optionsOrHost) {
    if (optionsOrHost.host) host = optionsOrHost.host;
    if (optionsOrHost.scale) scale = optionsOrHost.scale;
    if (optionsOrHost.port) customPort = optionsOrHost.port;
    if (optionsOrHost.token !== undefined) customToken = optionsOrHost.token;
    if (optionsOrHost.protocol) protocol = optionsOrHost.protocol;
    else if (optionsOrHost.ssl) protocol = 'https';
  }

  const port = customPort ?? getVncPort(displayNumber);
  const tokenQuery = customToken ? `token=${encodeURIComponent(customToken)}&` : '';

  return `${protocol}://${host}:${port}/desktop.html?${tokenQuery}scale=${scale}`;
}

export function getVncWebSocketUrl(
  displayNumber: number,
  host: string = DEFAULT_EC2_HOST,
  customPort?: number,
  token?: string,
  secure: boolean = false
): string {
  const port = customPort ?? getVncPort(displayNumber);
  const proto = secure ? 'wss' : 'ws';
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${proto}://${host}:${port}/websockify${tokenQuery}`;
}

export async function resolveVncSession(
  user: string,
  display: number,
  token?: string,
  host: string = DEFAULT_EC2_HOST,
  execPort: number = 3000
): Promise<{ vncPort: number; execPort: number; status: string }> {
  try {
    const query = new URLSearchParams({ user, display: String(display) });
    if (token) query.set('token', token);
    const res = await fetch(`http://${host}:${execPort}/resolve?${query.toString()}`);
    if (res.ok) {
      const data = await res.json();
      return {
        vncPort: data.vncPort || getVncPort(display),
        execPort: data.execPort || execPort,
        status: data.status || 'running',
      };
    }
  } catch {
    // Fall back to default computation
  }
  return {
    vncPort: getVncPort(display),
    execPort,
    status: 'running',
  };
}
