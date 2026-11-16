// =============================================================================
// server/certificate.js — create (and cache) a self-signed HTTPS certificate.
//
// A certificate normally proves "this really is example.com" and is signed by
// an authority browsers trust. Ours is signed by nobody but ourselves, which
// is fine on a home network — the browser just asks you to confirm once.
//
// The certificate lists the addresses it is valid for (localhost and the
// Mac's Wi-Fi address). It is saved in .cert/ and reused, so you only have to
// accept the warning again if the Mac's address changes.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { generate } from 'selfsigned';

/**
 * @param {string} directory     where to cache the files
 * @param {string[]} addresses   LAN IPs the certificate should cover
 * @returns {Promise<{key: string, cert: string}>}
 */
export async function getCertificate(directory, addresses) {
  const keyFile = path.join(directory, 'key.pem');
  const certFile = path.join(directory, 'cert.pem');
  const metaFile = path.join(directory, 'meta.json');
  const wanted = JSON.stringify([...addresses].sort());

  // Reuse the cached certificate if it was made for the same addresses and
  // is less than a year old.
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const ageDays = (Date.now() - meta.created) / 86_400_000;
    if (meta.addresses === wanted && ageDays < 365) {
      return { key: fs.readFileSync(keyFile, 'utf8'), cert: fs.readFileSync(certFile, 'utf8') };
    }
  } catch {
    // No cache yet (or unreadable) — make a new one below.
  }

  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + 397); // iOS rejects long-lived certificates
  const pems = await generate([{ name: 'commonName', value: 'Kart Lab (local)' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' }, // type 2 = DNS name
          { type: 7, ip: '127.0.0.1' }, // type 7 = IP address
          ...addresses.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(metaFile, JSON.stringify({ addresses: wanted, created: Date.now() }));
  return { key: pems.private, cert: pems.cert };
}
