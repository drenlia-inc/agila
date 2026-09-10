/**
 * Generate and encrypt/decrypt dedicated Ed25519 SSH keypairs for agent GitHub work.
 */

import crypto from 'crypto';
export { encryptSecret, decryptSecret, canDecryptSecret } from './secretCrypto.js';

function sshString(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
}

function sshUint32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0);
  return buf;
}

/**
 * Extract raw 32-byte Ed25519 public key from a KeyObject.
 * @param {crypto.KeyObject} pubKeyObj
 */
function rawEd25519Public(pubKeyObj) {
  const der = pubKeyObj.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32);
}

/**
 * Extract raw 32-byte Ed25519 seed from PKCS8 private key.
 * @param {crypto.KeyObject} privKeyObj
 */
function rawEd25519PrivateSeed(privKeyObj) {
  const der = privKeyObj.export({ type: 'pkcs8', format: 'der' });
  // PKCS8 for Ed25519: … OCTET STRING (0x04 0x20) then 32-byte seed near the end
  for (let i = 0; i < der.length - 33; i++) {
    if (der[i] === 0x04 && der[i + 1] === 0x20) {
      return der.subarray(i + 2, i + 34);
    }
  }
  throw new Error('Unable to extract Ed25519 private seed');
}

/**
 * @param {crypto.KeyObject} pubKeyObj
 * @param {string} comment
 */
function toOpenSshEd25519Public(pubKeyObj, comment) {
  const raw = rawEd25519Public(pubKeyObj);
  const keyType = Buffer.from('ssh-ed25519');
  const payload = Buffer.concat([sshString(keyType), sshString(raw)]);
  return `ssh-ed25519 ${payload.toString('base64')}${comment ? ` ${comment}` : ''}`;
}

/**
 * Build an unencrypted OpenSSH private key (openssh-key-v1) for Ed25519.
 * @param {crypto.KeyObject} pubKeyObj
 * @param {crypto.KeyObject} privKeyObj
 * @param {string} comment
 */
function toOpenSshEd25519Private(pubKeyObj, privKeyObj, comment) {
  const pub = rawEd25519Public(pubKeyObj);
  const seed = rawEd25519PrivateSeed(privKeyObj);
  const privBlock = Buffer.concat([seed, pub]);
  const keyType = Buffer.from('ssh-ed25519');
  const publicBlob = Buffer.concat([sshString(keyType), sshString(pub)]);

  const check = crypto.randomBytes(4).readUInt32BE(0);
  let privateSection = Buffer.concat([
    sshUint32(check),
    sshUint32(check),
    sshString(keyType),
    sshString(pub),
    sshString(privBlock),
    sshString(Buffer.from(comment || ''))
  ]);

  const padLen = (8 - (privateSection.length % 8)) % 8;
  if (padLen) {
    const pad = Buffer.alloc(padLen);
    for (let i = 0; i < padLen; i++) pad[i] = i + 1;
    privateSection = Buffer.concat([privateSection, pad]);
  }

  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    sshString(Buffer.from('none')),
    sshString(Buffer.from('none')),
    sshString(Buffer.alloc(0)),
    sshUint32(1),
    sshString(publicBlob),
    sshString(privateSection)
  ]);

  const b64 = body.toString('base64');
  const lines = b64.match(/.{1,70}/g) || [];
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/**
 * @returns {{ publicKey: string, privateKey: string, fingerprint: string }}
 */
export function generateEd25519SshKeyPair(comment = 'easy-kanban-agent') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const opensshPublicLine = toOpenSshEd25519Public(publicKey, comment);
  const opensshPrivate = toOpenSshEd25519Private(publicKey, privateKey, comment);

  const fingerprint = crypto
    .createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');

  return {
    publicKey: opensshPublicLine.trim(),
    privateKey: opensshPrivate,
    fingerprint: `SHA256:${fingerprint}`
  };
}
