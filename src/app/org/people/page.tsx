import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getPrimaryOrgForUser, getMembersForOrg, getUserOrgRole } from '@/lib/organizations';
import db from '@/lib/db';
import PeopleClient from './PeopleClient';

export default async function OrgPeoplePage() {
  const session = getSession();
  if (!session) redirect('/login');

  const org = await getPrimaryOrgForUser(session.id);
  if (!org) redirect('/');

  const role = await getUserOrgRole(org.id, session.id);
  const canManage = role === 'owner' || role === 'admin';

  const members = await getMembersForOrg(org.id);

  const pendingInvites = db.prepare(`
    SELECT id, email, role, created_at, expires_at
    FROM org_invitations
    WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC
  `).all(org.id, Date.now()) as any[];

  return (
    <PeopleClient
      org={org}
      currentUserId={session.id}
      canManage={canManage}
      members={members}
      pendingInvites={pendingInvites}
    />
  );
}
