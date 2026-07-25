import { redirect } from 'next/navigation';
import { requireAdminSession, getSupabaseServerClient } from '@/lib/supabaseServer';
import SchedulesClient from './SchedulesClient';

export default async function SchedulesPage() {
  const admin = await requireAdminSession();
  if (!admin) redirect('/login');

  // MVP: default to the first enabled station. A station switcher gets added
  // once multi-station is actually in use, per the "single station running
  // at a time" decision.
  const supabase = getSupabaseServerClient();
  const { data: station } = await supabase
    .from('stations')
    .select('*')
    .eq('enabled', true)
    .limit(1)
    .single();

  if (!station) {
    return <p className="p-6 text-cream/70">No station found. Create one first.</p>;
  }

  return <SchedulesClient stationId={station.id} stationTimezone={station.timezone} />;
}
