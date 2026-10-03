import { NextResponse } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isOrgOwnerOrAdmin, getOrganization } from '@/lib/organizations';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { orgId, email, role } = await request.json();
    if (!orgId || !email || !role) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }
    if (!['admin', 'member'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    const canManage = await isOrgOwnerOrAdmin(orgId, session.id);
    if (!canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const org = await getOrganization(orgId);
    if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 });

    const normalizedEmail = email.toLowerCase().trim();

    // Already a member?
    const alreadyMember = db.prepare(`
      SELECT 1 FROM organization_members om
      JOIN users u ON u.id = om.user_id
      WHERE om.org_id = ? AND u.email = ?
    `).get(orgId, normalizedEmail);
    if (alreadyMember) return NextResponse.json({ error: 'User is already a member' }, { status: 409 });

    // Existing active invite?
    const existingInvite = db.prepare(`
      SELECT id FROM org_invitations
      WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND expires_at > ?
    `).get(orgId, normalizedEmail, Date.now());
    if (existingInvite) return NextResponse.json({ error: 'Invitation already pending for this email' }, { status: 409 });

    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    db.prepare(`
      INSERT INTO org_invitations (id, org_id, email, role, invited_by, token, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, orgId, normalizedEmail, role, session.id, token, expiresAt);

    // Send invitation email
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const inviteUrl = `${protocol}://${host}/api/org/invitations/accept?token=${token}`;

    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_PORT === '465',
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        const safeFrom = (process.env.SMTP_FROM || process.env.SMTP_USER || '').replace(/["']/g, '').trim();
        await transporter.sendMail({
          from: safeFrom,
          to: normalizedEmail,
          subject: `You've been invited to ${org.name} on Cortex`,
          text: `${session.email} invited you to join ${org.name}. Click here to accept: ${inviteUrl}`,
          html: `<p><strong>${session.email}</strong> invited you to join <strong>${org.name}</strong> on Cortex.</p><p><a href="${inviteUrl}">Accept invitation</a></p><p>This link expires in 7 days.</p>`,
        });
      } catch (err) {
        console.error('Invitation email error:', err);
      }
    } else {
      console.log(`✉️ Invitation link for ${normalizedEmail}: ${inviteUrl}`);
    }

    return NextResponse.json({
      id,
      org_id: orgId,
      email: normalizedEmail,
      role,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    }, { status: 201 });
  } catch (err: any) {
    console.error('Invitation POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const invite = db.prepare('SELECT org_id FROM org_invitations WHERE id = ?').get(id) as { org_id: string } | undefined;
    if (!invite) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const canManage = await isOrgOwnerOrAdmin(invite.org_id, session.id);
    if (!canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    db.prepare('DELETE FROM org_invitations WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
