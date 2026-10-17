// The three questions the live demo offers. The first is the hero challenge: an
// exam-style u-substitution that looks harder than it is and hides one trap (the
// factor from du = 2x dx). The other two are university Calculus I staples. Each
// carries its answer key, so the tutor marks against a known result instead of
// diagnosing from scratch. The question text is drawn on the page, so it stays
// short and plain. Wording avoids the words banned by the copy rules.

export interface DemoQuestion {
  id: 'q-challenge' | 'q-implicit' | 'q-limit';
  topic: string;
  text: string;
  answer: string;
  /**
   * The final value as it might be spoken or shown, each matched as a whole token
   * (lib/mark/schema statesResult), compared in canonical form so mixed digit/word
   * forms ("three quarters", "3/4") match too. Speech or a lesson line that states one of
   * these is replaced, and a written mark or hint that does is dropped, so the tutor
   * never gives the result to the student.
   */
  spokenForms: string[];
  markScheme: string[];
  /**
   * The worked solution the page shows when the visitor asks for it (never sent to
   * the tutor). One step per point, plus the trap the question is built around.
   */
  solution: { steps: { points: number; text: string }[]; trap: string };
}

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    id: 'q-challenge',
    topic: 'u-substitution',
    // The result is 6, not 1, on purpose: a result of 1 would make the guard drop
    // every spoken "one", including "cos 0 is one" in the middle of a lesson.
    text: 'Evaluate the integral of 6x sin(x²) dx from 0 to √π.',
    answer: '6',
    spokenForms: ['6', 'six'],
    markScheme: [
      'M1: substitutes u = x², du = 2x dx, so 6x dx = 3 du',
      'M1: changes the limits to u = 0 and u = π (or substitutes back to x² before evaluating at 0 and √π)',
      'M1: antiderivative −3cos u (or −3cos(x²))',
      'A1: −3cos π + 3cos 0 = 3 + 3 = 6',
      'Common slip: replacing 6x dx with 6 du, losing the factor of 1/2 from du = 2x dx (leads to 12)',
      'Common slip: keeping the x-limits 0 and √π after changing to u',
    ],
    solution: {
      steps: [
        { points: 1, text: 'Let u = x², so du = 2x dx and 6x dx = 3 du.' },
        { points: 1, text: 'Change the limits: x = 0 gives u = 0, and x = √π gives u = π.' },
        { points: 1, text: 'The integral of 3 sin u du from 0 to π is [−3 cos u] from 0 to π.' },
        { points: 1, text: '= −3 cos π + 3 cos 0 = 3 + 3 = 6' },
      ],
      trap: 'du = 2x dx, so 6x dx is 3 du, not 6 du. Writing 6 du doubles the result to 12 and loses a point.',
    },
  },
  {
    id: 'q-implicit',
    topic: 'Implicit differentiation',
    text: 'x² + y² = 25. Find dy/dx at the point (3, 4).',
    answer: '-3/4',
    spokenForms: ['-3/4', '3/4', '¾', 'three quarters', 'three fourths', '0.75'],
    markScheme: [
      'M1: differentiates implicitly: 2x + 2y·dy/dx = 0',
      'M1: rearranges: dy/dx = −x/y',
      'A1: −3/4',
      'Common slip: differentiating y² as 2y, without the dy/dx',
    ],
    solution: {
      steps: [
        { points: 1, text: 'Differentiate both sides with respect to x: 2x + 2y·dy/dx = 0.' },
        { points: 1, text: 'Rearrange: dy/dx = −x/y.' },
        { points: 1, text: 'At (3, 4): dy/dx = −3/4.' },
      ],
      trap: 'y depends on x, so y² differentiates to 2y·dy/dx by the chain rule, not to 2y.',
    },
  },
  {
    id: 'q-limit',
    topic: 'Limit',
    text: 'Find the limit of (√(x + 1) − 2)/(x − 3) as x → 3.',
    answer: '1/4',
    spokenForms: ['1/4', '¼', 'one quarter', 'a quarter', 'one fourth', '0.25'],
    markScheme: [
      "M1: multiplies top and bottom by the conjugate √(x + 1) + 2, or uses L'Hôpital: (1/(2√(x + 1)))/1",
      "M1: simplifies to 1/(√(x + 1) + 2), or evaluates L'Hôpital's quotient at x = 3",
      'A1: 1/4',
      'Common slip: substituting x = 3 straight away and calling 0/0 undefined, or zero',
    ],
    solution: {
      steps: [
        { points: 1, text: 'Multiply top and bottom by the conjugate √(x + 1) + 2. The top becomes (x + 1) − 4 = x − 3.' },
        { points: 1, text: 'Cancel x − 3, leaving the limit of 1/(√(x + 1) + 2) as x → 3.' },
        { points: 1, text: 'Substitute x = 3: 1/(2 + 2) = 1/4.' },
      ],
      trap: 'Putting x = 3 in straight away gives 0/0. That is not zero and not the end: it means simplify first.',
    },
  },
];

export function getDemoQuestion(id: unknown): DemoQuestion | undefined {
  return DEMO_QUESTIONS.find((q) => q.id === id);
}
