import { randomUUID } from 'crypto';
import db from './db';

export interface Organization {
  id: string;
  name: string;
  domain: string;
  ownerId: string;
  isPersonal: boolean;
  createdAt: string;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
  email?: string;
}

// Domains treated as personal mailboxes: a user signing up with one of these
// gets their own single-person organization instead of joining a shared one.
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.es', 'yahoo.co.uk', 'yahoo.com.ar', 'yahoo.com.mx', 'yahoo.fr',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'protonmail.com', 'proton.me',
  'mail.com', 'gmx.com', 'gmx.net',
  'yandex.com', 'yandex.ru',
]);

export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}

function rowToOrg(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    ownerId: row.owner_id,
    isPersonal: !!row.is_personal,
    createdAt: row.created_at,
  };
}

export async function getOrganizationsForUser(userId: string): Promise<(Organization & { role: string })[]> {
  const rows = db.prepare(`
    SELECT o.*, om.role
    FROM organizations o
    JOIN organization_members om ON om.org_id = o.id
    WHERE om.user_id = ?
    ORDER BY o.is_personal DESC, o.created_at ASC
  `).all(userId) as any[];
  return rows.map(r => ({ ...rowToOrg(r), role: r.role }));
}

export async function getOrganizationByDomain(domain: string): Promise<Organization | null> {
  const row = db.prepare('SELECT * FROM organizations WHERE domain = ?').get(domain.toLowerCase()) as any;
  return row ? rowToOrg(row) : null;
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId) as any;
  return row ? rowToOrg(row) : null;
}

export async function getMembersForOrg(orgId: string): Promise<OrgMember[]> {
  const rows = db.prepare(`
    SELECT om.org_id, om.user_id, om.role, om.joined_at, u.email
    FROM organization_members om
    JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ?
    ORDER BY om.joined_at ASC
  `).all(orgId) as any[];
  return rows.map(r => ({
    orgId: r.org_id,
    userId: r.user_id,
    role: r.role,
    joinedAt: r.joined_at,
    email: r.email,
  }));
}

export async function getMembershipCount(orgId: string): Promise<number> {
  return (db.prepare('SELECT COUNT(*) as c FROM organization_members WHERE org_id = ?').get(orgId) as { c: number }).c;
}

/**
 * Ensure the user belongs to an organization, derived from their email domain:
 * - Corporate domain → they join the existing org for that domain, or become
 *   the owner of a new one (first user from the domain claims it).
 * - Personal mailbox → they get their own single-person organization.
 */
export async function ensureUserOrganization(userId: string, email: string): Promise<Organization> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) throw new Error('Invalid email');

  const isPersonal = isPersonalEmailDomain(domain);
  const orgDomain = isPersonal ? email.toLowerCase() : domain;

  const org = await getOrganizationByDomain(orgDomain);
  if (org) {
    const existing = db.prepare(
      'SELECT 1 FROM organization_members WHERE org_id = ? AND user_id = ?'
    ).get(org.id, userId);
    if (!existing) {
      db.prepare(
        "INSERT INTO organization_members (org_id, user_id, role) VALUES (?, ?, 'member')"
      ).run(org.id, userId);
    }
    return org;
  }

  const orgId = randomUUID();
  const name = isPersonal ? email : domain;
  db.prepare(
    'INSERT INTO organizations (id, name, domain, owner_id, is_personal) VALUES (?, ?, ?, ?, ?)'
  ).run(orgId, name, orgDomain, userId, isPersonal ? 1 : 0);
  db.prepare(
    "INSERT INTO organization_members (org_id, user_id, role) VALUES (?, ?, 'owner')"
  ).run(orgId, userId);

  return (await getOrganization(orgId))!;
}

export async function isOrgOwnerOrAdmin(orgId: string, userId: string): Promise<boolean> {
  const row = db.prepare(
    "SELECT role FROM organization_members WHERE org_id = ? AND user_id = ? AND role IN ('owner', 'admin')"
  ).get(orgId, userId);
  return !!row;
}

export async function getUserOrgRole(orgId: string, userId: string): Promise<string | null> {
  const row = db.prepare(
    'SELECT role FROM organization_members WHERE org_id = ? AND user_id = ?'
  ).get(orgId, userId) as { role: string } | undefined;
  return row?.role ?? null;
}

/** The user's "primary" org — the one they own, else the first they belong to. */
export async function getPrimaryOrgForUser(userId: string): Promise<Organization | null> {
  const orgs = await getOrganizationsForUser(userId);
  const owned = orgs.find(o => o.role === 'owner');
  return owned || orgs[0] || null;
}
