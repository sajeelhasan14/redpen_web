import { guardSpeak } from '@/lib/speak/handler';
import { redisCounter, MemoryCounter } from '@/lib/guard/counter';
import { readCtx, toResponse } from '@/lib/http';

export const runtime = 'nodejs';
const counter = process.env.REDIS_URL ? redisCounter() : new MemoryCounter();

export async function GET() {
  return Response.json({ available: Boolean(process.env.OPENAI_API_KEY), provider: process.env.OPENAI_API_KEY ? 'openai' : null });
}

export async function POST(req: Request) {
  const g = await guardSpeak(await req.json().catch(() => null), readCtx(req), { counter, now: () => new Date() });
  if (!g.ok) return toResponse(g.result);
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: 'No voice service configured.' }, { status: 503 });
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.TTS_MODEL ?? 'gpt-4o-mini-tts',
      voice: process.env.TTS_VOICE ?? 'sage',
      input: g.text,
      instructions: 'You are a patient British maths tutor talking to a student while writing on a page. Warm, unhurried, clear.',
      response_format: 'mp3',
      stream_format: 'audio',
    }),
  }).catch(() => null);
  if (!r?.ok) return Response.json({ error: 'Voice unavailable.' }, { status: 502 });
  return new Response(r.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
}
