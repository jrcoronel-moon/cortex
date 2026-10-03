import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { createSessionValue } from '@/lib/auth';
import { ensureUserOrganization } from '@/lib/organizations';

export async function GET(request: Request) {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || '';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const baseUrl = process.env.APP_URL || (host ? `${proto}://${host}` : request.url);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const storedState = cookies().get('google_oauth_state')?.value;
  cookies().delete('google_oauth_state');

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(new URL('/login?error=oauth_invalid_state', baseUrl));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(new URL('/login?error=oauth_not_configured', baseUrl));
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL('/login?error=oauth_token_exchange', baseUrl));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      return NextResponse.redirect(new URL('/login?error=oauth_userinfo', baseUrl));
    }

    const profile = await userRes.json() as { email: string; verified_email: boolean };

    if (!profile.email || !profile.verified_email) {
      return NextResponse.redirect(new URL('/login?error=email_unverified', baseUrl));
    }

    const email = profile.email.toLowerCase();
    const domain = email.split('@')[1];

    const existingUser = db.prepare('SELECT id, is_banned FROM users WHERE email = ?').get(email) as any;
    if (existingUser?.is_banned) {
      return NextResponse.redirect(new URL('/login?error=banned', baseUrl));
    }

    let userId: string;
    if (!existingUser) {
      userId = randomUUID();
      // created_at set explicitly — don't rely on the ALTER-added column default.
      db.prepare("INSERT INTO users (id, email, role, created_at) VALUES (?, ?, 'user', datetime('now'))").run(userId, email);
    } else {
      userId = (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any).id;
    }

    // Ensure user has an organization (creates personal org or joins corporate one)
    try {
      await ensureUserOrganization(userId, email);
    } catch (orgErr: any) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(orgErr.message)}`, baseUrl));
    }

    // Consume pending invite if email matches
    const inviteToken = cookies().get('pending_invite_token')?.value;
    if (inviteToken) {
      cookies().delete('pending_invite_token');
      const invite = db.prepare(`
        SELECT id, org_id, email, role, expires_at, accepted_at
        FROM org_invitations WHERE token = ?
      `).get(inviteToken) as any;
      if (invite && !invite.accepted_at && Date.now() < invite.expires_at && invite.email.toLowerCase() === email) {
        db.transaction(() => {
          db.prepare('INSERT OR IGNORE INTO organization_members (org_id, user_id, role) VALUES (?, ?, ?)').run(invite.org_id, userId, invite.role);
          db.prepare('UPDATE org_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ?').run(invite.id);
        })();
      }
    }

    const sessionVal = createSessionValue(email);
    if (!sessionVal) {
      return NextResponse.redirect(new URL('/login?error=session_failed', baseUrl));
    }

    const returnTo = cookies().get('google_oauth_return_to')?.value;
    cookies().delete('google_oauth_return_to');
    const finalRedirect = returnTo && returnTo.startsWith('/') ? returnTo : '/';

    const res = NextResponse.redirect(new URL(finalRedirect, baseUrl));
    res.cookies.set('cortex_session', sessionVal, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 86400,
    });
    return res;
  } catch (err: any) {
    console.error('Google OAuth callback error:', err);
    return NextResponse.redirect(new URL('/login?error=oauth_callback', baseUrl));
  }
}
