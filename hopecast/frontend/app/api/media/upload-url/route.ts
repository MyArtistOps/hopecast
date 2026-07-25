import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminSession } from '@/lib/supabaseServer';

export async function POST(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { filename } = await req.json();
  if (!filename) return NextResponse.json({ error: 'filename is required' }, { status: 400 });

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${Date.now()}-${safeName}`;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase.storage.from('media').createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Could not create upload URL' }, { status: 400 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
