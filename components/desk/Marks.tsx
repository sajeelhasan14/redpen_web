// Small hand-drawn red-pen marks used around the page. Paths carry pathLength=1
// so the .draw class can animate them on with stroke-dashoffset.

const RED = '#dd1b27';

export function Tick({ className = '', width = 7, delay = 0 }: { className?: string; width?: number; delay?: number }) {
  return (
    <svg className={className} viewBox="0 0 110 90" aria-hidden="true" focusable="false">
      <path className="draw" style={{ '--d': `${delay}s` } as React.CSSProperties} pathLength={1} d="M10 52 C 18 58, 28 70, 38 79 C 56 52, 76 26, 101 7" stroke={RED} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Ring({ text, className = '' }: { text: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 130 116" aria-hidden="true" focusable="false">
      <path className="draw" style={{ '--d': '1.1s' } as React.CSSProperties} pathLength={1} d="M70 10 C 112 8, 124 40, 120 62 C 115 92, 84 108, 56 104 C 24 100, 8 78, 10 54 C 12 28, 38 10, 76 14" stroke={RED} strokeWidth={4} fill="none" strokeLinecap="round" />
      <text className="hand ink-in" style={{ '--d': '1.5s' } as React.CSSProperties} x="64" y="72" textAnchor="middle" fontSize="38" fill={RED}>{text}</text>
    </svg>
  );
}

/** An antiderivative with its constant missing, ringed: the plus-c.mov scrap. */
export function FractionsArt({ note }: { note: string }) {
  return (
    <svg className="frac-art" viewBox="0 0 240 150" aria-hidden="true" focusable="false">
      <text className="hand" x="18" y="46" fontSize="26" fill="#1c2733">∫ 2x dx</text>
      <text className="hand" x="18" y="98" fontSize="26" fill="#1c2733">=</text>
      <text className="hand" x="56" y="98" fontSize="26" fill="#1c2733">x²</text>
      <path className="draw" style={{ '--d': '1.6s' } as React.CSSProperties} pathLength={1} d="M78 71 C 102 70, 116 80, 112 93 C 108 106, 74 110, 54 104 C 38 98, 38 80, 58 74 C 64 72, 74 71, 84 72" stroke={RED} strokeWidth={3} fill="none" strokeLinecap="round" />
      <text className="hand ink-in" style={{ '--d': '2s' } as React.CSSProperties} x="226" y="134" textAnchor="end" fontSize="16" fill={RED}>{note}</text>
    </svg>
  );
}

/** Step 1: the challenge, with the substitution started. */
export function StepQuestion({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 280 170" aria-hidden="true" focusable="false">
      <text x="20" y="34" fontSize="13" fill="#5b6472" fontFamily="inherit">Evaluate ∫ 6x sin(x²) dx from 0 to √π.</text>
      <text className="hand" x="20" y="78" fontSize="24" fill="#1c2733">u = x², du = 2x dx</text>
      <text className="hand" x="20" y="124" fontSize="24" fill="#1c2733">= ∫ 6 sin u du</text>
      <path d="M20 146 H 160" stroke="#d9d4c7" strokeWidth="1.5" strokeDasharray="3 5" />
    </svg>
  );
}

/** Step 2: the first wrong line marked: 6 du should be 3 du. */
export function StepMarked({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 280 170" aria-hidden="true" focusable="false">
      <text className="hand" x="20" y="60" fontSize="24" fill="#1c2733">u = x², du = 2x dx</text>
      <text className="hand" x="20" y="124" fontSize="24" fill="#1c2733">= ∫</text>
      <text className="hand" x="54" y="124" fontSize="24" fill="#1c2733" data-slip="">6</text>
      <text className="hand" x="72" y="124" fontSize="24" fill="#1c2733">sin u du</text>
      <path d="M50 122 C 56 118, 62 112, 70 106" stroke={RED} strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <text className="hand" x="54" y="98" fontSize="22" fill={RED}>3</text>
      <text className="hand" x="150" y="160" fontSize="16" fill={RED}>this line</text>
      <path d="M146 155 C 128 154, 110 148, 96 136" stroke={RED} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M96 136 l 9 1 M96 136 l 1 8" stroke={RED} strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Step 3: the re-teach, with the factor from du, then a similar question. */
export function StepFix({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 280 170" aria-hidden="true" focusable="false">
      <text className="hand" x="20" y="48" fontSize="24" fill="#1c2733">du = 2x dx</text>
      <path d="M128 40 C 150 34, 166 46, 160 62" stroke={RED} strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M160 62 l -7 -6 M160 62 l 4 -8" stroke={RED} strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <text className="hand" x="20" y="96" fontSize="22" fill={RED}>so 6x dx = 3 du</text>
      <text className="hand" x="20" y="146" fontSize="17" fill="#1c2733">now try: ∫ 4x cos(x²) dx</text>
    </svg>
  );
}
