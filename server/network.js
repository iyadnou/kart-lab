// =============================================================================
// server/network.js — find this computer's address on the local network.
// =============================================================================

import os from 'node:os';

/**
 * Returns the IPv4 addresses other devices on the Wi-Fi can reach us at,
 * e.g. ['192.168.1.23']. Usually there is exactly one.
 */
export function getLanAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const net of interfaces ?? []) {
      // Skip IPv6 and "internal" addresses like 127.0.0.1 (this machine only).
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  // Typical home/office ranges first, in case there are VPN adapters too.
  const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return addresses.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}
