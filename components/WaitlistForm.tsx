'use client';

import { useEffect, useState } from 'react';
import { COPY } from '@/content/copy';
import { COURSES } from '@/lib/boards';

const W = COPY.waitlist;

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [course, setCourse] = useState<string>(COURSES[0]);
  const [school, setSchool] = useState('');
  const [examDate, setExamDate] = useState('');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('waitlist');
    if (p === 'confirmed') setMsg(W.confirmed);
    if (p === 'invalid') setMsg(W.invalid);
  }, []);

  // The page sits behind HumanGate, so the rp_session cookie already proves this visitor is human.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    const r = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: 'student', course, school: school || null, examDate: examDate || null }),
    }).catch(() => null);
    const j = (await r?.json().catch(() => ({}))) as { message?: string; error?: string };
    if (r?.ok) setMsg(j.message ?? W.sent);
    else if (r?.status === 403) setMsg(W.expired);
    else setMsg(j.error ?? W.failed); // includes the 429 limit message
    setSending(false);
  };

  return (
    <form className="waitlist" onSubmit={submit}>
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={W.email} aria-label={W.email} autoComplete="email" />
      <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label={W.course}>
        {COURSES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input type="text" value={school} onChange={(e) => setSchool(e.target.value)} placeholder={W.school} aria-label={W.school} maxLength={120} autoComplete="organization" />
      <label className="field-label">
        <span>{W.examDate}</span>
        <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
      </label>
      <button className="btn primary" disabled={sending}>{W.button}</button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}
