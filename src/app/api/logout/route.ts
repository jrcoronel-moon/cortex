import { NextResponse } from 'next/server';
import { logout } from '@/lib/auth';

export async function POST() {
  logout();
  return NextResponse.json({ success: true });
}

export async function GET(request: Request) {
  logout();
  const base = new URL(request.url).origin;
  return NextResponse.redirect(new URL('/login', base));
}
