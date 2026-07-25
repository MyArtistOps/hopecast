import { redirect } from 'next/navigation';
import { requireAdminSession } from '@/lib/supabaseServer';
import ControlRoom from './ControlRoom';

export default async function DashboardPage() {
  const admin = await requireAdminSession();
  if (!admin) redirect('/login');

  // In the full build this reads the selected/default station from the DB;
  // hardcoded placeholder here for the MVP scaffold.
  return <ControlRoom stationName="Delana Hope Weekend Radio" />;
}
