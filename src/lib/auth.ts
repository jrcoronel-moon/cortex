import crypto from 'crypto';
import { cookies } from 'next/headers';
import db from './db';

// Simple session handling using symmetric signing for local MVP
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET environment variable is required in production'
      );
    }
    console.warn(
      '⚠️ SESSION_SECRET not set. Using insecure fallback key for development only.'
    );
    return 'cortex-super-secret-key-1234!';
  }
  return secret;
}

// Resolved lazily on first use, NOT at module load: `next build` imports this
// module during page-data collection WITHOUT runtime env (no .env in CI), and
// throwing there would fail the build. The check still fires at runtime.
let _secret: string | null = null;
function secret(): string {
  if (_secret === null) _secret = getSessionSecret();
  return _secret;
}

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function createSessionValue(email: string) {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
  if (!user) return null;

  const payloadStr = JSON.stringify({ id: user.id, exp: Date.now() + 86400000 });
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payloadB64).digest('hex');

  return `${payloadB64}.${sig}`;
}

export function getSession() {
  const cookie = cookies().get('cortex_session')?.value;
  if (!cookie) return null;

  const parts = cookie.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret()).update(payloadB64).digest('hex');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  } catch {
    return null;
  }

  try {
    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const { id, exp } = JSON.parse(payloadStr);
    if (exp < Date.now()) return null;

    // Fetch fresh role + email from DB on every request — role changes take effect immediately
    const user = db.prepare('SELECT id, email, role, is_banned FROM users WHERE id = ?').get(id) as any;
    if (!user || user.is_banned) return null;

    return { id: user.id, email: user.email, role: user.role };
  } catch {
    return null;
  }
}

export function logout() {
  cookies().delete('cortex_session');
}
