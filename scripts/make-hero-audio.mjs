// One-off: renders the hero line to public/audio/hero.mp3 with OpenAI TTS.
import { writeFileSync } from 'node:fs';

// Keep in step with HERO_SPEECH in content/hero-script.ts, spelled out for the voice.
const text = 'Look at your d u. If d u is 2x d x, what does 6x d x become in terms of d u?';
const r = await fetch('https://api.openai.com/v1/audio/speech', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4o-mini-tts', voice: 'sage', input: text, response_format: 'mp3',
    instructions: 'A patient American calculus TA, warm and unhurried, gently asking a question.',
  }),
});
if (!r.ok) throw new Error(`TTS ${r.status}: ${await r.text()}`);
writeFileSync('public/audio/hero.mp3', Buffer.from(await r.arrayBuffer()));
console.log('wrote public/audio/hero.mp3');
