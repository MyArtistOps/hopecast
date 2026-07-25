import { redirect } from 'next/navigation';
import { requireAdminSession, getSupabaseServerClient } from '@/lib/supabaseServer';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const admin = await requireAdminSession();
  if (!admin) redirect('/login');

  const supabase = getSupabaseServerClient();
  const { data: station } = await supabase.from('stations').select('*').eq('enabled', true).limit(1).single();
  if (!station) return <p className="p-6 text-cream/70">No station found. Create one first.</p>;

  const { data: destination } = await supabase
    .from('stream_destinations')
    .select('id, destination_name, youtube_channel_title, oauth_connected_at, enabled')
    .eq('station_id', station.id)
    .eq('platform', 'youtube')
    .maybeSingle();

  return <SettingsClient stationId={station.id} destination={destination} />;
}
