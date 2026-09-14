// @concord-file workbench-access-addresses
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { isIP } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

const url = (host: string, port: number) => `http://${host.includes(':') ? `[${host}]` : host}:${port}/`;

/** Display reachable interface candidates without changing the server trust policy. */
export function viewAddresses(host: string, port: number, interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): { local: readonly string[]; network: readonly string[] } {
  const wildcard = host === '0.0.0.0' || host === '::';
  const loopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
  if (!wildcard) return loopback ? { local: [url(host, port)], network: [] } : { local: [], network: [url(host, port)] };
  const addresses = Object.values(interfaces).flatMap(value => value ?? []).filter((entry: NetworkInterfaceInfo) => (
    !entry.internal && (host === '::' || entry.family === 'IPv4') && isIP(entry.address) !== 0 && !entry.address.includes('%') && !/^fe[89ab]/i.test(entry.address)
  ));
  return { local: [url('localhost', port)], network: [...new Set(addresses.map(entry => url(entry.address, port)))].sort() };
}
