import { jwtVerify } from 'jose';
import { verifyPanelToken as readViewer, type PanelViewer } from '../public/panel/token';
/** Viewer routes never grant a durable identity to a logged-out or server-role token. */
export async function verifyViewerToken(authorization: string | null, key: Uint8Array): Promise<PanelViewer> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], requiredClaims: ['exp', 'channel_id', 'opaque_user_id', 'role'] });
  if (!['viewer', 'moderator', 'broadcaster'].includes(String(payload.role))) throw new Error('Not a viewer token');
  const opaque = String(payload.opaque_user_id);
  if (!/^[UA][A-Za-z0-9]+$/.test(opaque) || opaque.startsWith('A') && payload.user_id !== undefined) throw new Error('Invalid viewer identity');
  return readViewer(authorization, key);
}
