import assert from 'node:assert/strict';
import test from 'node:test';
import type { NetworkInterfaceInfo } from 'node:os';
import { viewAddresses } from '../dist/view-addresses.js';
import { humanOutput } from '../dist/presentation.js';

// @concord-case workbench-local-and-network-urls
// @concord-contract docs/feature/web-workbench/use-case/use-web-workbench.md
test('startup URLs respect the actual bind family and do not advertise wildcard or link-local addresses', () => {
  const address = (address: string, family: 'IPv4' | 'IPv6', internal = false): NetworkInterfaceInfo => ({ address, family, internal, netmask: '', mac: '', cidr: null, ...(family === 'IPv6' ? { scopeid: 0 } : {}) } as NetworkInterfaceInfo);
  const interfaces = { lo: [address('127.0.0.1', 'IPv4', true)], eth0: [address('192.0.2.10', 'IPv4'), address('2001:db8::10', 'IPv6'), address('fe80::1', 'IPv6')] };
  assert.deepEqual(viewAddresses('0.0.0.0', 4317, interfaces), { local: ['http://localhost:4317/'], network: ['http://192.0.2.10:4317/'] });
  assert.deepEqual(viewAddresses('127.0.0.1', 4317, interfaces), { local: ['http://127.0.0.1:4317/'], network: [] });
  assert.deepEqual(viewAddresses('::', 4317, interfaces).network, ['http://192.0.2.10:4317/', 'http://[2001:db8::10]:4317/']);
  assert.equal(humanOutput({ operation: 'view', root: '/repo', host: '0.0.0.0', port: 4317, ...viewAddresses('0.0.0.0', 4317, interfaces) }), [
    'Concord view', 'Root: /repo', 'Host: 0.0.0.0  Port: 4317', '',
    '  Local:   http://localhost:4317/', '  Network: http://192.0.2.10:4317/',
  ].join('\n'));
});
