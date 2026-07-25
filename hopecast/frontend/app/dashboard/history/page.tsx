import { redirect } from 'next/navigation';
import { requireAdminSession, getSupabaseServerClient } from '@/lib/supabaseServer';
import HistoryClient from './HistoryClient';

export default async function HistoryPage() {
  const admin = await requireAdminSession();
  if (!admin) redirect('/login');

  const supabase = getSupabaseServerClient();
  const { data: station } = await supabase.from('stations').select('*').eq('enabled', true).limit(1).single();
  if (!station) return <p className="p-6 text-cream/70">No station found. Create one first.</p>;

  return <HistoryClient stationId={station.id} />;
}
