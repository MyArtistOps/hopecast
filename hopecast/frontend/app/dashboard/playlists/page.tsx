import { redirect } from 'next/navigation';
import { requireAdminSession, getSupabaseServerClient } from '@/lib/supabaseServer';
import PlaylistsIndexClient from './PlaylistsIndexClient';

export default async function PlaylistsPage() {
  const admin = await requireAdminSession();
  if (!admin) redirect('/login');

  const supabase = getSupabaseServerClient();
  const { data: station } = await supabase.from('stations').select('*').eq('enabled', true).limit(1).single();
  if (!station) return <p className="p-6 text-cream/70">No station found. Create one first.</p>;

  return <PlaylistsIndexClient stationId={station.id} />;
}
