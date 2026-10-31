import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { sha256 } from '../export/project';
import { AuthorizationPayloadSchema, AuthorizationSchema, type Authorization, type AuthorizationPayload } from './schema';

/**
 * Founding an edition needs the founder's signed word (Spec 01 R2). The service holds only the founder's Ed25519
 * public key (`ATLAS_FOUNDER_PUBLIC_KEY`, PEM text or a path to it); the private key never touches this repository
 * or this service. An authorization names the edition, the exact observation revision and the exact taxonomy bytes,
 * so it cannot be reused for different land.
 */
export function canonicalPayload(payload: AuthorizationPayload): string {
  const p = AuthorizationPayloadSchema.parse(payload);
  return JSON.stringify({ kind: p.kind, edition: p.edition, revision: p.revision, taxonomySha256: p.taxonomySha256, issuedAt: p.issuedAt, issuedBy: p.issuedBy });
}

export function founderKey(pem: string): { key: KeyObject; fingerprint: string } {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The founder key must be an Ed25519 public key.');
  return { key, fingerprint: sha256(key.export({ type: 'spki', format: 'der' })) };
}

/** For the founder's own tooling: signs with a private key held outside this service. */
export function signAuthorization(payload: AuthorizationPayload, privateKeyPem: string): Authorization {
  const signature = sign(null, Buffer.from(canonicalPayload(payload)), privateKeyPem).toString('base64');
  return AuthorizationSchema.parse({ version: 1, payload, signature });
}

export function verifyAuthorization(authorization: Authorization, key: KeyObject): boolean {
  try {
    return verify(null, Buffer.from(canonicalPayload(authorization.payload)), key, Buffer.from(authorization.signature, 'base64'));
  } catch {
    return false;
  }
}
