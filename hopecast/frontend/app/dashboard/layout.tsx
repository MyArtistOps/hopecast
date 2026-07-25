import Link from 'next/link';

const NAV = [
  { href: '/dashboard', label: 'Control Room' },
  { href: '/dashboard/playlists', label: 'Playlists' },
  { href: '/dashboard/media', label: 'Media Library' },
  { href: '/dashboard/schedules', label: 'Schedules' },
  { href: '/dashboard/history', label: 'History' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="border-b border-gold/20 px-6 py-3 flex gap-5 overflow-x-auto text-sm">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="text-cream/70 hover:text-gold whitespace-nowrap">
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
