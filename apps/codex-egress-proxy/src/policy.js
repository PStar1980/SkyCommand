'use strict';

const net = require('node:net');

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function hostAllowed(host, allowlist) {
  const normalized = normalizeHost(host);
  if (!normalized || net.isIP(normalized)) return false;
  return allowlist.some((item) => normalized === item);
}

function ipv4IsPublic(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  return true;
}

function ipv6IsPublic(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    return net.isIPv4(mapped) && ipv4IsPublic(mapped);
  }
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
  if (!Number.isInteger(first) || first < 0x2000 || first > 0x3fff) return false;
  const groups = normalized.split(':').filter(Boolean);
  const second = Number.parseInt(groups[1] || '0', 16);
  // Fail closed for the entire IANA special-purpose 2001::/23 block, not only
  // the individual assignments currently known to this proxy.
  if (first === 0x2001 && second <= 0x01ff) return false;
  if (first === 0x2002 || first === 0x3fff) return false;
  return true;
}

function addressIsPublic(address) {
  const family = net.isIP(address);
  if (family === 4) return ipv4IsPublic(address);
  if (family === 6) return ipv6IsPublic(address);
  return false;
}

function parseAuthority(authority) {
  const value = String(authority || '').trim();
  const ipv6 = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6) return { host: normalizeHost(ipv6[1]), port: Number(ipv6[2]) };
  const match = value.match(/^([^:]+):(\d+)$/);
  if (!match) return null;
  return { host: normalizeHost(match[1]), port: Number(match[2]) };
}

module.exports = {
  addressIsPublic,
  hostAllowed,
  normalizeHost,
  parseAuthority,
};
