import crypto from 'crypto';

// Server-only. Never import this from a 'use client' file. The key comes
// from an env var that lives only on the Next.js server (Vercel/Netlify
// dashboard env, or a local .env.local) — never in the browser bundle and
// never committed to source control.

function getKey(): Buffer {
  const raw = process.env.YOUTUBE_OAUTH_ENCRYPTION_KEY;
  if (!raw) throw new Error('YOUTUBE_OAUTH_ENCRYPTION_KEY is not set');
  // Accept either a 32-byte hex string or fall back to hashing whatever's given.
  return raw.length === 64 ? Buffer.from(raw, 'hex') : crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as iv:tag:ciphertext, all base64 — one text column, no plaintext.
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = stored.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
