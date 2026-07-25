import './globals.css';

export const metadata = {
  title: 'HopeCast Platform',
  description: 'Private broadcast management platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-base text-cream min-h-screen font-sans">{children}</body>
    </html>
  );
}
