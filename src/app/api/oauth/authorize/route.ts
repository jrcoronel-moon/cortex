import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  getOAuthApplication,
  isValidRedirectUri,
} from '@/lib/oauth';

function getPublicBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || 'cortex.example.com';
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  return `${protocol}://${host}`;
}

export async function GET(request: NextRequest) {
  try {
    const baseUrl = getPublicBaseUrl(request);
    const session = getSession();
    if (!session) {
      // Preserve original authorize URL so we can come back after login
      const returnTo = new URL(request.url);
      returnTo.protocol = baseUrl.startsWith('https') ? 'https:' : 'http:';
      returnTo.host = baseUrl.replace(/^https?:\/\//, '');
      const loginUrl = new URL('/login', baseUrl);
      loginUrl.searchParams.set('returnTo', returnTo.pathname + returnTo.search);
      return NextResponse.redirect(loginUrl);
    }

    const searchParams = request.nextUrl.searchParams;
    const clientId = searchParams.get('client_id');
    const redirectUri = searchParams.get('redirect_uri');
    const responseType = searchParams.get('response_type') || 'code';
    const codeChallenge = searchParams.get('code_challenge');

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: 'Missing client_id or redirect_uri' },
        { status: 400 }
      );
    }

    const app = getOAuthApplication(clientId);
    if (!app) {
      console.error('[OAuth] App not found for client_id:', clientId);
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    if (!isValidRedirectUri(app, redirectUri)) {
      console.error('[OAuth] Invalid redirect_uri. Stored:', (app as any).redirectUri, 'Got:', redirectUri);
      return NextResponse.json(
        { error: 'Invalid redirect_uri' },
        { status: 400 }
      );
    }

    if (responseType !== 'code') {
      return NextResponse.json(
        { error: 'Only response_type=code is supported' },
        { status: 400 }
      );
    }

    // Request is valid and the user is logged in. Show an explicit consent
    // screen instead of silently issuing the code — the code is only created
    // once the user clicks Authorize (POST /api/oauth/authorize/approve).
    const consentUrl = new URL('/authorize', baseUrl);
    searchParams.forEach((value, key) => consentUrl.searchParams.set(key, value));
    consentUrl.searchParams.set('client_name', app.name || 'the application');
    return NextResponse.redirect(consentUrl);
  } catch (error) {
    console.error('OAuth authorize error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
