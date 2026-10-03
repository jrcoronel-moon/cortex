import { NextResponse } from 'next/server';
import { generateToken } from '@/lib/auth';
import db from '@/lib/db';
import nodemailer from 'nodemailer';
import { rateLimitCheck } from '@/lib/rateLimit';
import { randomUUID } from 'crypto';
import { ensureUserOrganization } from '@/lib/organizations';

export async function POST(request: Request) {
  try {
    // Rate limiting: 5 requests per 15 minutes per IP
    const clientIp = request.headers.get('x-forwarded-for') ||
                      request.headers.get('x-real-ip') ||
                      'unknown';
    const { allowed, retryAfterSeconds } = rateLimitCheck(
      `auth:${clientIp}`,
      5,
      15 * 60 * 1000
    );

    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': retryAfterSeconds.toString() }
        }
      );
    }

    const { email, returnTo } = await request.json();

    const domain = email.split('@')[1];
    const isDomainAllowed = db.prepare('SELECT id FROM groups WHERE name = ?').get(domain);
    const user = db.prepare('SELECT id, is_banned FROM users WHERE email = ?').get(email) as any;
    
    if (user && user.is_banned) {
      return NextResponse.json({ error: 'User is banned' }, { status: 403 });
    }

    // Also check folder_shares for access (shared folders)
    const hasSharedAccess = db.prepare(
      "SELECT 1 FROM folder_shares WHERE shared_with = ? OR shared_with = ? LIMIT 1"
    ).get(email, '@' + domain);

    // Check if their domain already has an organization (corporate domain claim)
    const existingOrg = db.prepare("SELECT id FROM organizations WHERE domain = ? AND is_personal = 0").get(domain);

    if (!user && !isDomainAllowed && !hasSharedAccess && !existingOrg) {
      // Allow signup for any new user — they will get their own personal org or join existing corporate org
      // This is the new model: domain is claimed by first user, not by admin whitelist
    }

    let userId: string;
    if (!user) {
      userId = randomUUID();
      // created_at set explicitly — don't rely on the ALTER-added column default.
      db.prepare("INSERT INTO users (id, email, role, created_at) VALUES (?, ?, 'user', datetime('now'))").run(userId, email);
    } else {
      userId = (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any).id;
    }

    // Ensure user belongs to an organization (creates personal/corporate org as needed)
    try {
      await ensureUserOrganization(userId, email);
    } catch (orgErr: any) {
      // Seat limit reached, etc.
      return NextResponse.json({ error: orgErr.message }, { status: 403 });
    }

    const token = generateToken();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins

    db.prepare('INSERT OR REPLACE INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)')
      .run(token, email, expiresAt);

    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const rt = (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/')) ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
    const magicLink = `${protocol}://${host}/api/verify?token=${token}${rt}`;
    
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_PORT === '465',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        const safeFromAddress = (process.env.SMTP_FROM || process.env.SMTP_USER || '').replace(/["']/g, '').trim();

        await transporter.sendMail({
          from: safeFromAddress,
          to: email,
          subject: 'Sign in to Cortex',
          text: `Click here to sign in: ${magicLink}`,
          html: `<p>Click here to sign in: <a href="${magicLink}">${magicLink}</a></p>`,
        });
        console.log(`✉️ Magic link email sent to ${email}`);
      } catch (err: any) {
        console.error('SMTP Error:', err.message);
        console.log(`✉️ FALLBACK MAGIC LINK FOR ${email}: ${magicLink}`);
      }
    } else {
      // Create a test account on the fly for local testing
      try {
        console.log('No SMTP config found. Generating Ethereal test account...');
        const testAccount = await nodemailer.createTestAccount();
        const transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        const info = await transporter.sendMail({
          from: '"Cortex Auth" <no-reply@cortex.local>',
          to: email,
          subject: 'Sign in to Cortex',
          text: `Click here to sign in: ${magicLink}`,
          html: `<p>Click here to sign in: <a href="${magicLink}">${magicLink}</a></p>`,
        });
        console.log('\n=========================================');
        console.log(`✉️ Magic link email sent to ${email} (dev mode)`);
        console.log(`🔗 Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
        console.log('=========================================\n');
      } catch (err) {
        console.log('\n=========================================');
        console.log(`✉️ Email service unavailable for ${email} (check SMTP config)`);
        console.log('=========================================\n');
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
