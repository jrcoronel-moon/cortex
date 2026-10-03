import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getPrimaryOrgForUser, getUserOrgRole } from '@/lib/organizations';
import { updateOrgName } from '../actions';

export default async function OrgSettingsPage() {
  const session = getSession();
  if (!session) redirect('/login');

  const org = await getPrimaryOrgForUser(session.id);
  if (!org) redirect('/');

  const role = await getUserOrgRole(org.id, session.id);
  const canManage = role === 'owner' || role === 'admin';

  if (!canManage) {
    return (
      <div>
        <h2 style={{ marginBottom: '8px' }}>Settings</h2>
        <p style={{ opacity: 0.6 }}>Only owners and admins can change organization settings.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ marginBottom: '8px' }}>Settings</h2>
      <p style={{ opacity: 0.6, marginBottom: '24px', fontSize: '0.88rem' }}>Manage your organization&apos;s basic information.</p>

      <form action={updateOrgName} style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '500px' }}>
        <input type="hidden" name="orgId" value={org.id} />

        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px', fontWeight: 500 }}>Organization name</label>
          <input
            type="text"
            name="name"
            defaultValue={org.name}
            required
            style={{
              width: '100%', padding: '10px 12px', borderRadius: '6px',
              background: 'var(--surface-2)', border: '1px solid var(--border-light)',
              color: 'var(--foreground)', outline: 'none', fontSize: '0.92rem',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '6px', fontWeight: 500, opacity: 0.6 }}>Domain</label>
          <input
            type="text"
            value={org.domain}
            disabled
            style={{
              width: '100%', padding: '10px 12px', borderRadius: '6px',
              background: 'var(--surface-1)', border: '1px solid var(--border-light)',
              color: 'rgba(255,255,255,0.5)', outline: 'none', fontSize: '0.92rem',
            }}
          />
          <p style={{ fontSize: '0.78rem', opacity: 0.5, marginTop: '6px' }}>
            Domain is permanent and cannot be changed.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary">Save changes</button>
        </div>
      </form>
    </div>
  );
}
