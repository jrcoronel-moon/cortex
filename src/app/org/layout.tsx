import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getPrimaryOrgForUser, getUserOrgRole } from '@/lib/organizations';
import Link from 'next/link';
import OrgNav from './OrgNav';

export default async function OrgLayout({ children }: { children: React.ReactNode }) {
  const session = getSession();
  if (!session) redirect('/login');

  const org = await getPrimaryOrgForUser(session.id);
  if (!org) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
        <h2 style={{ color: '#ef4444' }}>No organization found</h2>
        <Link href="/" className="btn btn-primary">Back to workspace</Link>
      </div>
    );
  }

  const role = await getUserOrgRole(org.id, session.id);
  const canManage = role === 'owner' || role === 'admin';

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '0.75rem', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Organization</div>
          <h1 style={{ fontSize: '1.8rem', margin: '4px 0 0' }}>{org.name}</h1>
          <div style={{ fontSize: '0.78rem', opacity: 0.6, marginTop: '2px' }}>
            {org.isPersonal ? 'Personal account' : `Domain: ${org.domain}`}
          </div>
        </div>
        <Link href="/" className="btn">Back to workspace</Link>
      </div>

      <OrgNav canManage={canManage} />

      <div style={{ background: 'var(--surface-1)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border-light)' }}>
        {children}
      </div>
    </div>
  );
}
