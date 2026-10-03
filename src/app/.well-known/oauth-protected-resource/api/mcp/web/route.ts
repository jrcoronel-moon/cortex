import { NextRequest, NextResponse } from 'next/server';

// RFC 9728 path-suffixed protected-resource metadata for the /api/mcp/web
// resource, mirroring the root document.

function getPublicBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || 'cortex.example.com';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const baseUrl = getPublicBaseUrl(request);
  return NextResponse.json({
    resource: `${baseUrl}/api/mcp/web`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    resource_documentation: `${baseUrl}/`,
  }, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
