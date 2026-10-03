"use server";

import db from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isOrgOwnerOrAdmin } from '@/lib/organizations';
import { revalidatePath } from 'next/cache';

export async function updateOrgName(formData: FormData) {
  const session = getSession();
  if (!session) return;

  const orgId = formData.get('orgId') as string;
  const name = (formData.get('name') as string)?.trim();
  if (!orgId || !name) return;

  const canManage = await isOrgOwnerOrAdmin(orgId, session.id);
  if (!canManage) return;

  db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(name, orgId);
  revalidatePath('/org/settings');
}
