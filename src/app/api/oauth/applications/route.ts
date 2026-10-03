import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  createOAuthApplication,
  listOAuthApplications,
  deleteOAuthApplication,
  ClientType,
} from '@/lib/oauth';

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apps = listOAuthApplications(session.id);
  return NextResponse.json(apps);
}

export async function POST(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, clientType = 'custom', customRedirectUri, exposedFolders } = await request.json();
    if (!name) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    }

    if (clientType === 'custom' && !customRedirectUri) {
      return NextResponse.json({ error: 'customRedirectUri required for custom client type' }, { status: 400 });
    }

    const app = createOAuthApplication(
      session.id,
      name,
      clientType as ClientType,
      exposedFolders || [],
      customRedirectUri
    );
    return NextResponse.json(app, { status: 201 });
  } catch (err: any) {
    console.error('OAuth POST Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { applicationId, exposedFolders } = await request.json();
  if (!applicationId || !Array.isArray(exposedFolders)) {
    return NextResponse.json({ error: 'Missing applicationId or exposedFolders' }, { status: 400 });
  }

  const db = (await import('@/lib/db')).default;
  db.prepare('UPDATE oauth_applications SET exposed_folders = ? WHERE id = ? AND user_id = ?').run(
    JSON.stringify(exposedFolders),
    applicationId,
    session.id
  );

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const applicationId = searchParams.get('id');

  if (!applicationId) {
    return NextResponse.json({ error: 'Missing application id' }, { status: 400 });
  }

  deleteOAuthApplication(applicationId, session.id);
  return NextResponse.json({ success: true });
}
