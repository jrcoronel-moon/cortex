"use server";

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/superadmin';

// Every action below mutates platform-wide state, so every one of them must
// re-check authorization — server actions are directly invokable endpoints and
// the page-level gate does NOT protect them.
function requireSuperAdmin(): void {
  const session = getSession();
  if (!session || !isSuperAdmin(session)) throw new Error('forbidden');
}

export async function createGroup(formData: FormData) {
  requireSuperAdmin();
  const name = formData.get('name') as string;
  if (!name) return;
  const id = randomUUID();
  db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run(id, name);
  revalidatePath('/admin');
}

export async function editDomain(formData: FormData) {
  requireSuperAdmin();
  const id = formData.get('id') as string;
  const newName = formData.get('name') as string;
  if (!id || !newName) return;
  db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(newName, id);
  revalidatePath('/admin');
}

export async function deleteDomain(id: string) {
  requireSuperAdmin();
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  db.prepare('DELETE FROM group_spaces WHERE group_id = ?').run(id);
  revalidatePath('/admin');
}

export async function toggleSpaceAccess(groupId: string, spaceId: string, grant: boolean) {
  requireSuperAdmin();
  if (grant) {
    db.prepare('INSERT OR IGNORE INTO group_spaces (group_id, space_id) VALUES (?, ?)').run(groupId, spaceId);
  } else {
    db.prepare('DELETE FROM group_spaces WHERE group_id = ? AND space_id = ?').run(groupId, spaceId);
  }
  revalidatePath('/admin');
}

export async function deleteUser(id: string) {
  requireSuperAdmin();
  db.transaction(() => {
    db.prepare('DELETE FROM organization_members WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM oauth_tokens WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM oauth_authorization_codes WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM api_keys WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  })();
  revalidatePath('/admin');
}

export async function updateUserEmail(formData: FormData) {
  requireSuperAdmin();
  const id = formData.get('id') as string;
  const email = (formData.get('email') as string)?.trim().toLowerCase();
  if (!id || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  // Reject if email already in use by another user
  const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, id);
  if (existing) return;
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, id);
  revalidatePath('/admin');
}

export async function toggleBanUser(id: string, isBanned: boolean) {
  requireSuperAdmin();
  db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(isBanned ? 1 : 0, id);
  revalidatePath('/admin');
}

export async function toggleUserRole(id: string, newRole: string) {
  requireSuperAdmin();
  if (newRole !== 'viewer' && newRole !== 'editor') return;
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, id);
  revalidatePath('/admin');
}
