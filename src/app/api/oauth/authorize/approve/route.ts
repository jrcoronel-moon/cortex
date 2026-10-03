import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getOAuthApplication, isValidRedirectUri, createAuthorizationCode } from '@/lib/oauth';

// Called by the consent screen (/authorize) when the logged-in user clicks
// Authorize or Deny. Only here — after an explicit user action — is the
// authorization code minted and bound to the user's session.
export async function POST(request: NextRequest) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { client_id, redirect_uri, code_challenge, state, approve } = body;
  if (!client_id || !redirect_uri) {
    return NextResponse.json({ error: 'missing client_id or redirect_uri' }, { status: 400 });
  }

  const app = getOAuthApplication(client_id);
  if (!app) return NextResponse.json({ error: 'application_not_found' }, { status: 404 });
  if (!isValidRedirectUri(app, redirect_uri)) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }

  const callbackUrl = new URL(redirect_uri);
  if (state) callbackUrl.searchParams.set('state', state);

  if (!approve) {
    callbackUrl.searchParams.set('error', 'access_denied');
    return NextResponse.json({ redirect: callbackUrl.toString() });
  }

  // Bind the code to THIS logged-in user.
  const code = createAuthorizationCode(app.id, session.id, code_challenge || undefined);
  callbackUrl.searchParams.set('code', code);
  return NextResponse.json({ redirect: callbackUrl.toString() });
}
