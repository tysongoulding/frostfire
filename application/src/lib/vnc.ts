export const DEFAULT_EC2_HOST = '44.242.94.86';

export interface VncOptions {
  scale?: 'fixed' | 'fit';
  host?: string;
  port?: number;
  token?: string;
}

export function getVncUrl(
  displayNumber: number,
  optionsOrHost?: VncOptions | string
): string {
  let host = DEFAULT_EC2_HOST;
  let scale: 'fixed' | 'fit' = 'fixed';
  let customPort: number | undefined;
  let customToken: string | undefined;

  if (typeof optionsOrHost === 'string') {
    host = optionsOrHost;
  } else if (optionsOrHost) {
    if (optionsOrHost.host) host = optionsOrHost.host;
    if (optionsOrHost.scale) scale = optionsOrHost.scale;
    if (optionsOrHost.port) customPort = optionsOrHost.port;
    if (optionsOrHost.token !== undefined) customToken = optionsOrHost.token;
  }

  const defaultPortMap: Record<number, number> = {
    1: 6080,
    2: 6081,
    3: 6082,
    4: 6083,
    5: 6084,
    6: 6085,
    7: 6086,
    8: 6087,
    9: 6088,
  };

  const port = customPort ?? defaultPortMap[displayNumber] ?? (displayNumber === 1 ? 6080 : 6081);
  const token = customToken !== undefined
    ? customToken
    : (!customPort && (displayNumber === 2 || displayNumber === 3) ? `user${displayNumber}` : '');
  const tokenQuery = token ? `token=${token}&` : '';

  return `http://${host}:${port}/desktop.html?${tokenQuery}scale=${scale}`;
}
