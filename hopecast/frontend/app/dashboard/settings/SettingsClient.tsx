const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgUploading, setBgUploading] = useState(false);
  const [bgMessage, setBgMessage] = useState<string | null>(null);

  const uploadBackground = async () => {
    if (!bgFile) return;
    setBgUploading(true);
    setBgMessage(null);
    try {
      const urlRes = await fetch('/api/media/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: bgFile.name }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error);

      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      const { error: uploadErr } = await sb.storage.from('media').uploadToSignedUrl(urlData.path, urlData.token, bgFile);
      if (uploadErr) throw uploadErr;

      const patchRes = await fetch('/api/stations', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: stationId, backgroundUrl: urlData.path }),
      });
      if (!patchRes.ok) throw new Error('Could not save background image');
      setBgMessage('Background image saved. It will be used the next time a songs-only broadcast starts.');
    } catch (err: any) {
      setBgMessage(err.message || 'Upload failed');
    } finally {
      setBgUploading(false);
    }
  };
