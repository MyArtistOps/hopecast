import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { requireAdminSession } from '@/lib/supabaseServer';
import { getGoogleAuthUrl } from '@/lib/youtubeApi';

export async function GET(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const stationId = req.nextUrl.searchParams.get('stationId');
  if (!stationId) return NextResponse.json({ error: 'stationId is required' }, { status: 400 });

  // The state param round-trips through Google, so it's signed to prevent
  // an attacker from redirecting a connected channel to a station they
  // don't administer.
  const state = jwt.sign({ stationId, adminId: admin.id }, process.env.CONTROL_API_JWT_SECRET!, { expiresIn: '10m' });

  return NextResponse.redirect(getGoogleAuthUrl(state));
}
