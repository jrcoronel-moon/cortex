import WorkspaceClient from '@/components/WorkspaceClient';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import db from '@/lib/db';
import { getWorkspacesForUser, ensureDefaultWorkspace } from '@/lib/workspaces';
import { ensureUserOrganization } from '@/lib/organizations';
import { getFiles, getNodeContent } from '@/lib/drive';

export default async function Page() {
  const session = getSession();

  if (!session) {
    redirect('/login');
  }

  // Ensure user has an organization (safety net — should be created on login)
  try {
    await ensureUserOrganization(session.id, session.email);
  } catch (err: any) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '16px' }}>
        <h2 style={{ color: '#ef4444' }}>Access Denied</h2>
        <p>{err.message}</p>
      </div>
    );
  }

  // Legacy groups support (for old admin-managed domain whitelist UI)
  let groups: any[] = [];
  if (session.role === 'admin') {
    groups = db.prepare('SELECT id, name FROM groups').all();
  } else {
    const domain = session.email.split('@')[1];
    const allowedDomain = db.prepare('SELECT id, name FROM groups WHERE name = ?').get(domain) as any;
    if (allowedDomain) groups = [allowedDomain];
  }

  // Ensure user has at least one workspace
  await ensureDefaultWorkspace(session.id);
  const workspaces = await getWorkspacesForUser(session.id);

  // SSR the file tree (without content) so it paints on first render instead of
  // waiting for a client round-trip. Content stays lazy per note — except the
  // default Welcome note, which we hydrate here so it shows immediately.
  const initialNodes = await getFiles();
  const welcome = initialNodes.find(n => n.name === 'Welcome.md');
  if (welcome) {
    welcome.content = (await getNodeContent(welcome.id)) ?? '';
  }

  return <WorkspaceClient user={session} groups={groups} workspaces={workspaces} initialNodes={initialNodes} />;
}
