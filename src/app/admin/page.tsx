import db from '@/lib/db';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import styles from '@/components/components.module.css';
import { toggleBanUser, deleteUser, toggleUserRole, updateUserEmail } from './actions';
import Link from 'next/link';
import { isSuperAdmin } from '@/lib/superadmin';
import { Users, UserPlus, FileText, Building2, ArrowUpRight, ArrowDownRight, Folder, Settings, Gauge, Users as UsersIcon } from 'lucide-react';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// % change badge: green ↗ / red ↘ pill next to the KPI value.
function TrendBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '2px',
      fontSize: '0.7rem', fontWeight: 600, padding: '2px 6px', borderRadius: '5px',
      background: up ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
      color: up ? '#34d399' : '#f87171',
    }}>
      {Math.abs(pct)}% {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
    </span>
  );
}

// Server-rendered SVG line/area chart (no client JS): monthly series.
function TrendChart({ labels, series }: { labels: string[]; series: { name: string; color: string; values: number[] }[] }) {
  const W = 860, H = 250, PL = 36, PR = 14, PT = 14, PB = 26;
  const max = Math.max(1, ...series.flatMap(s => s.values));
  const x = (i: number) => PL + (i * (W - PL - PR)) / Math.max(1, labels.length - 1);
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / max);
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(max * f));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Monthly trend">
      <defs>
        {series.map((s, si) => (
          <linearGradient key={si} id={`grad-${si}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.35)">{v}</text>
        </g>
      ))}
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        const area = `M ${x(0)},${y(s.values[0] ?? 0)} ` + s.values.map((v, i) => `L ${x(i)},${y(v)}`).join(' ') + ` L ${x(s.values.length - 1)},${H - PB} L ${x(0)},${H - PB} Z`;
        return (
          <g key={si}>
            <path d={area} fill={`url(#grad-${si})`} />
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.6" fill={s.color} />)}
          </g>
        );
      })}
      {labels.map((l, i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="rgba(255,255,255,0.45)">{l}</text>
      ))}
    </svg>
  );
}

export default function AdminPage() {
  const session = getSession();
  if (!session) redirect('/login');

  if (!isSuperAdmin(session)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '16px' }}>
        <h2 style={{ color: '#ef4444' }}>Access denied</h2>
        <p>This panel is restricted to platform administrators.</p>
        <Link href="/" className="btn btn-primary">Back to workspace</Link>
      </div>
    );
  }

  const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  const hasCreatedAt = userCols.some(c => c.name === 'created_at');

  let orgs: any[] = [];
  let users: any[] = [];
  try {
    orgs = db.prepare(`
      SELECT o.id, o.name, o.domain, o.is_personal, o.created_at,
             COALESCE(u.email, '(deleted)') as owner_email,
             (SELECT COUNT(*) FROM organization_members WHERE org_id = o.id) as member_count
      FROM organizations o
      LEFT JOIN users u ON u.id = o.owner_id
      ORDER BY o.is_personal ASC, o.created_at DESC
    `).all() as any[];

    const createdAtSelect = hasCreatedAt ? 'u.created_at' : "'' as created_at";
    const orderByClause = hasCreatedAt ? 'ORDER BY u.created_at DESC' : 'ORDER BY u.email ASC';

    users = db.prepare(`
      SELECT u.id, u.email, u.role, u.is_banned,
             ${createdAtSelect}, GROUP_CONCAT(o.name, ', ') as orgs
      FROM users u
      LEFT JOIN organization_members om ON om.user_id = u.id
      LEFT JOIN organizations o ON o.id = om.org_id
      GROUP BY u.id
      ${orderByClause}
    `).all() as any[];
  } catch (err: any) {
    return (
      <div style={{ padding: '40px' }}>
        <h2 style={{ color: '#ef4444' }}>Admin query failed</h2>
        <pre style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: '6px', fontSize: '0.78rem' }}>{err.message}</pre>
        <Link href="/" className="btn">Back</Link>
      </div>
    );
  }

  const cnt = (sql: string): number => {
    try { return (db.prepare(sql).get() as any)?.c ?? 0; } catch { return 0; }
  };
  const pct = (cur: number, prev: number): number | null =>
    prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : null;

  const users30 = hasCreatedAt ? cnt("SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now','-30 day')") : 0;
  const usersPrev30 = hasCreatedAt ? cnt("SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now','-60 day') AND created_at < datetime('now','-30 day')") : 0;
  const docsTotal = cnt("SELECT COUNT(*) c FROM nodes WHERE type = 'file'");
  const docs30 = cnt("SELECT COUNT(*) c FROM nodes WHERE type = 'file' AND created_at >= datetime('now','-30 day')");
  const docsPrev30 = cnt("SELECT COUNT(*) c FROM nodes WHERE type = 'file' AND created_at >= datetime('now','-60 day') AND created_at < datetime('now','-30 day')");

  const now = new Date();
  const monthKeys: string[] = [];
  const monthLabels: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
    monthLabels.push(MONTHS[m.getMonth()]);
  }
  const monthly = (sql: string): Map<string, number> => {
    try {
      const rows = db.prepare(sql).all() as { m: string; c: number }[];
      return new Map(rows.filter(r => r.m).map(r => [r.m, r.c]));
    } catch { return new Map(); }
  };
  const usersByMonth = hasCreatedAt
    ? monthly("SELECT strftime('%Y-%m', created_at) m, COUNT(*) c FROM users WHERE created_at IS NOT NULL AND created_at != '' GROUP BY m")
    : new Map<string, number>();
  const docsByMonth = monthly("SELECT strftime('%Y-%m', created_at) m, COUNT(*) c FROM nodes WHERE type = 'file' AND created_at IS NOT NULL GROUP BY m");

  const kpis = [
    { label: 'Total users', icon: Users, value: users.length, badge: pct(users30, usersPrev30), sub: null as string | null },
    { label: 'New sign-ups (30d)', icon: UserPlus, value: users30, badge: pct(users30, usersPrev30), sub: null },
    { label: 'Documents', icon: FileText, value: docsTotal, badge: pct(docs30, docsPrev30), sub: `${docs30} this month` },
    { label: 'Organizations', icon: Building2, value: orgs.length, badge: null, sub: `${orgs.filter(o => !o.is_personal).length} shared · ${orgs.filter(o => o.is_personal).length} personal` },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      <div className={`${styles.ribbon} ${styles.glass}`}>
        <Link href="/" className={styles.ribbonIcon} title="Workspace">
          <Folder size={20} />
        </Link>
        <Link href="/org/people" className={styles.ribbonIcon} title="Organization">
          <UsersIcon size={20} />
        </Link>
        <Link href="/settings" className={styles.ribbonIcon} title="Settings">
          <Settings size={20} />
        </Link>
        <div className={styles.ribbonDivider} />
        <span className={styles.ribbonIcon} title="Admin" style={{ opacity: 1, background: 'rgba(99,102,241,0.25)', color: '#c7cbff' }}>
          <Gauge size={20} />
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header className={styles.editorHeader}>
          <span style={{ fontSize: '1.05rem', fontWeight: 600 }}>Admin</span>
          <Link href="/" className="btn">Workspace view</Link>
        </header>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div className={styles.adminContainer}>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
              {kpis.map(k => (
                <div key={k.label} className="glass-panel" style={{ padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', opacity: 0.65 }}>
                    <k.icon size={14} />
                    {k.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
                    <span style={{ fontSize: '1.75rem', fontWeight: 650, lineHeight: 1 }}>{k.value}</span>
                    <TrendBadge pct={k.badge} />
                  </div>
                  {k.sub && <div style={{ fontSize: '0.72rem', opacity: 0.5, marginTop: '6px' }}>{k.sub}</div>}
                </div>
              ))}
            </div>

            <div className="glass-panel" style={{ padding: '20px 24px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', opacity: 0.65 }}>Growth</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>New users and documents per month</div>
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.76rem', opacity: 0.8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><i style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} /> Users</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><i style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }} /> Documents</span>
                </div>
              </div>
              <TrendChart
                labels={monthLabels}
                series={[
                  { name: 'Users', color: '#6366f1', values: monthKeys.map(k => usersByMonth.get(k) || 0) },
                  { name: 'Documents', color: '#38bdf8', values: monthKeys.map(k => docsByMonth.get(k) || 0) },
                ]}
              />
            </div>

            <div className={`${styles.adminCard} glass-panel`} style={{ padding: '24px', marginBottom: '24px' }}>
              <h2>Organizations</h2>
              <p style={{ opacity: 0.7, marginBottom: '16px', fontSize: '0.88rem' }}>
                Every organization on this instance. An organization is claimed by the first user of its
                email domain; personal mailboxes get a single-person organization.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-light)', textAlign: 'left', fontSize: '0.78rem', opacity: 0.7 }}>
                    <th style={{ padding: '8px 6px' }}>Name</th>
                    <th style={{ padding: '8px 6px' }}>Domain</th>
                    <th style={{ padding: '8px 6px' }}>Owner</th>
                    <th style={{ padding: '8px 6px' }}>Type</th>
                    <th style={{ padding: '8px 6px' }}>Members</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map(o => (
                    <tr key={o.id} style={{ borderBottom: '1px solid var(--surface-1)' }}>
                      <td style={{ padding: '8px 6px', fontWeight: 500 }}>{o.name}</td>
                      <td style={{ padding: '8px 6px', fontSize: '0.85rem', opacity: 0.7 }}>{o.domain}</td>
                      <td style={{ padding: '8px 6px', fontSize: '0.85rem', opacity: 0.7 }}>{o.owner_email}</td>
                      <td style={{ padding: '8px 6px', fontSize: '0.78rem' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: '999px',
                          background: o.is_personal ? 'rgba(107,114,128,0.2)' : 'rgba(99,102,241,0.2)',
                          color: o.is_personal ? '#9ca3af' : '#a5b4fc',
                        }}>
                          {o.is_personal ? 'Personal' : 'Shared'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 6px' }}>{o.member_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={`${styles.adminCard} glass-panel`} style={{ padding: '24px' }}>
              <h2>User management</h2>
              <p style={{ opacity: 0.7, marginBottom: '16px', fontSize: '0.88rem' }}>
                All users on this instance. Edit email, change role, ban/unban, delete.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-light)', textAlign: 'left', fontSize: '0.78rem', opacity: 0.7 }}>
                      <th style={{ padding: '8px 6px' }}>Email</th>
                      <th style={{ padding: '8px 6px' }}>Role</th>
                      <th style={{ padding: '8px 6px' }}>Organizations</th>
                      <th style={{ padding: '8px 6px' }}>Status</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--surface-1)', verticalAlign: 'middle' }}>
                        <td style={{ padding: '8px 6px' }}>
                          <form action={updateUserEmail} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <input type="hidden" name="id" value={u.id} />
                            <input type="email" name="email" defaultValue={u.email} required className="adminEmailInput" />
                            <button type="submit" title="Save email" style={{ padding: '2px 6px', fontSize: '0.7rem', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
                              ✓
                            </button>
                          </form>
                        </td>
                        <td style={{ padding: '8px 6px', opacity: 0.7, fontSize: '0.85rem' }}>{u.role}</td>
                        <td style={{ padding: '8px 6px', fontSize: '0.78rem', opacity: 0.7, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u.orgs || '—'}
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <span style={{ color: u.is_banned ? '#ef4444' : '#10b981', fontSize: '0.85rem' }}>{u.is_banned ? 'Banned' : 'Active'}</span>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <form action={toggleBanUser.bind(null, u.id, !u.is_banned)}>
                              <button type="submit" className="btn" style={{ padding: '3px 8px', fontSize: '0.78rem' }}>
                                {u.is_banned ? 'Unban' : 'Ban'}
                              </button>
                            </form>
                            {u.role !== 'admin' && (
                              <form action={toggleUserRole.bind(null, u.id, u.role === 'editor' ? 'viewer' : 'editor')}>
                                <button type="submit" className="btn" style={{ padding: '3px 8px', fontSize: '0.78rem', background: 'var(--surface-2)' }}>
                                  Make {u.role === 'editor' ? 'viewer' : 'editor'}
                                </button>
                              </form>
                            )}
                            {u.id !== session.id && (
                              <form action={deleteUser.bind(null, u.id)}>
                                <button type="submit" className="btn" style={{ padding: '3px 8px', fontSize: '0.78rem', background: 'rgba(239,68,68,0.12)', color: '#e06c75' }}>
                                  Delete
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
