import { redirect } from 'next/navigation';
import { requireAdminSession, getSupabaseServerClient } from '@/lib/supabaseServer';
import PlaylistBuilderClient from './PlaylistBuilderClient';

export default async function PlaylistDetailPage({ params }: { params: { id: string } }) {
  const admin = await requireAdminSession();
  if (!admin) redirect('/login');

  const supabase = getSupabaseServerClient();
  const { data: playlist } = await supabase.from('playlists').select('*').eq('id', params.id).single();
  if (!playlist) return <p className="p-6 text-cream/70">Playlist not found.</p>;

  return <PlaylistBuilderClient playlistId={playlist.id} playlistName={playlist.name} stationId={playlist.station_id} />;
}
