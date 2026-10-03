import { NextRequest, NextResponse } from 'next/server';

// RFC 9728 §3.1: the protected-resource metadata for a resource at
// `<base>/api/mcp` is also served at
// `<base>/.well-known/oauth-protected-resource/api/mcp`. Some MCP clients build
// this path-suffixed URL instead of using the WWW-Authenticate `resource_metadata`
// value, so we serve it identically to the root variant.

function getPublicBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || 'cortex.example.com';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const baseUrl = getPublicBaseUrl(request);
  return NextResponse.json({
    resource: `${baseUrl}/api/mcp`,
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
