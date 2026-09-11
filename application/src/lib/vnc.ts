export const DEFAULT_EC2_HOST = '35.89.125.63';
export const DEFAULT_LAMBDA_HOST = '4hkbgj6zkmfm674e3nxlpagshq0moaoy.lambda-url.us-west-2.on.aws';

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

  // Handle Lambda microVM Function URLs or HTTPS hostnames
  if (host.includes('lambda-url') || host.startsWith('https://')) {
    const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const query = new URLSearchParams();
    query.set('display', String(displayNumber));
    if (customToken) query.set('token', customToken);
    return `https://${cleanHost}/display?${query.toString()}`;
  }

  const port = customPort ?? getVncPort(displayNumber);
  const tokenQuery = customToken ? `token=${encodeURIComponent(customToken)}&` : '';
  const resizeMode = scale === 'fit' ? 'scale' : 'off';

  return `${protocol}://${host}:${port}/vnc.html?${tokenQuery}autoconnect=true&resize=${resizeMode}&reconnect=true&show_dot=false&v=stealth`;
}

export function getVncWebSocketUrl(
  displayNumber: number,
  host: string = DEFAULT_LAMBDA_HOST,
  customPort?: number,
  token?: string,
  secure: boolean = false
): string {
  if (host.includes('lambda-url')) {
    const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    return `wss://${cleanHost}/websockify${tokenQuery}`;
  }
  const port = customPort ?? getVncPort(displayNumber);
  const proto = secure ? 'wss' : 'ws';
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${proto}://${host}:${port}/websockify${tokenQuery}`;
}

export async function resolveVncSession(
  user: string,
  display: number,
  token?: string,
  host: string = DEFAULT_LAMBDA_HOST,
  execPort: number = 3000
): Promise<{ vncPort: number; execPort: number; status: string }> {
  if (!host || host === DEFAULT_EC2_HOST || host === '44.242.94.86' || host.includes('lambda-url')) {
    return {
      vncPort: 443,
      execPort: 443,
      status: 'running',
    };
  }
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
