import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Handle both JSON and form-encoded requests
  const contentType = request.headers.get('content-type') || '';
  let body: Record<string, string>;

  if (contentType.includes('application/json')) {
    body = await request.json();
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData();
    body = {};
    formData.forEach((value, key) => {
      if (typeof value === 'string') {
        body[key] = value;
      }
    });
  } else {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // Get the proper host from X-Forwarded-Host (ngrok) or Host header
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || 'localhost:3001';
  const protocol = request.headers.get('x-forwarded-proto') || 'https';

  const response = await fetch(
    `${protocol}://${host}/api/oauth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
