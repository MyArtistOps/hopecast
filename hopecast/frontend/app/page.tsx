export default async function DashboardPage() {
  const admin = await requireAdminSession();
  if (!admin) redirect('/login');

  const supabase = getSupabaseServerClient();
  const { data: station } = await supabase.from('stations').select('*').eq('enabled', true).limit(1).single();
  if (!station) return <p className="p-6 text-cream/70">No station found.</p>;

  return <ControlRoom stationName={station.name} stationId={station.id} />;
}
