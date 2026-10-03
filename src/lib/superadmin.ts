// Platform administrators: may open /admin and run its actions.
//
// `role = 'admin'` is seeded from the ADMIN_EMAILS environment variable (see
// db.ts) and is the single source of truth. ADMIN_DOMAIN optionally grants the
// same access to every address on one domain, which is handy when a whole team
// operates the instance.
export function isSuperAdmin(user: { email?: string | null; role?: string | null } | null | undefined): boolean {
  if (!user?.email) return false;
  if (user.role === 'admin') return true;

  const domain = process.env.ADMIN_DOMAIN?.trim().toLowerCase();
  if (domain && user.email.toLowerCase().endsWith(`@${domain}`)) return true;

  return false;
}
