// Every word of marketing copy lives here so tests/copy.test.ts can police it.
// Audience: US university students taking Calculus I (and, later, the rest of the
// calculus sequence), who pay for themselves. No school names: we have no
// endorsement, so the questions and the tone say "university" instead.
// Rules: never "solve", "answers" or "homework done"; no accuracy numbers until
// measured; nothing that isn't true on the day it is published. Practice exams
// are not open yet, so everything about them is in the future tense.

import { SYLLABUS } from './syllabus';

export const COPY = {
  brand: 'RedPen Maths',
  // The page reads as a sheet of exam paper with a grader's margin. Margin notes
  // are red handwriting on a page, not claims.
  page: {
    navHow: 'How it works',
    navPricing: 'Pricing',
    navCta: 'Get my free marked exam',
    // The exam-booklet header over the hero challenge.
    bookletCourse: 'Calculus I · Midterm practice',
    bookletName: 'Name',
    bookletProblem: 'Problem 1 (4 points)',
    heroMargin: 'one trap',
    after: 'Nothing you write here is saved.',
    howTitle: 'How a practice exam will work',
    compareTitle: 'Not another app that works it out for you',
    coverageTitle: 'What it covers',
    trustTitle: 'Why you can trust the red pen',
    faqTitle: 'Before you sign up',
    signupTitle: "When's your next exam?",
    pricingMargin: 'free first',
    signupMargin: 'exam date?',
  },
  hero: {
    title: 'One midterm-style challenge.',
    titleRed: 'How ready are you?',
    sub: 'Try it on the board, if you like. Write your working and pause: a red pen marks the exact line that lost the point, the way your TA grades, then explains it out loud.',
    cta: 'Get my free marked exam',
    try: 'or try the challenge',
    ticks: ['Marks the exact line', 'Explains it out loud', 'First practice exam free'],
  },
  // The worked solution under the live demo, and the hook line under the hero.
  hook: {
    // The small link under the board that opens the worked solution.
    show: 'Want the explanation?',
    hide: 'Hide the explanation',
    heading: 'Worked solution',
    pointsOne: 'pt',
    trap: 'The trap:',
    // The hook line under both the pitch and the board, separate from the solution.
    lineKicker: 'Stared at that integral a little too long?',
    lineTitle: 'That feeling comes back on exam day.',
    lineTitleRed: 'Leave it here.',
    lineSub: 'RedPen grades every line of a full practice exam, the way your TA will. You find the step that loses points now, not when it costs you a grade.',
    lineCta: 'Get my free marked exam',
    lineNote: 'Your first practice exam is free.',
    stickyCta: 'Get my free marked exam',
  },
  how: {
    steps: [
      { t: 'Pick an exam. Write it like the real one.', d: 'Practice exams will be full calculus midterms and finals, set out like a university paper, with a timer if you want one. Every line written with a finger, mouse or stylus.' },
      { t: 'Every line gets marked', d: 'The red pen strikes the first line that lost a point. The working that follows correctly from it keeps its credit, the way partial credit works on the real exam.' },
      { t: 'You get a fix list, not just a score', d: 'Each slip explained out loud, like a TA in office hours, then similar questions to try until it sticks.' },
    ],
  },
  // A static, clearly labelled mock of a marked practice exam: what the visitor would pay for.
  report: {
    title: 'What you will get back',
    label: 'Example of a marked practice exam. Practice exams are not open yet.',
    exam: 'Calculus I · Midterm practice',
    score: '31 / 40',
    problems: [
      { n: 'Limits and continuity', s: '4 / 4' },
      { n: 'Chain rule', s: '2 / 3' },
      { n: 'Related rates', s: '5 / 8' },
      { n: 'Optimization', s: '7 / 7' },
      { n: 'Riemann sums and the FTC', s: '8 / 10' },
      { n: 'u-substitution', s: '5 / 8' },
    ],
    costlyTitle: 'The lines that cost the most',
    costly: [
      { pts: '−3', text: 'Problem 3: the radius is shrinking, but dr/dt was written as +2.' },
      { pts: '−3', text: 'Problem 6: after u = x², the limits were left as 0 and √π.' },
    ],
    fixTitle: 'Fix these before your exam',
    fix: ['Signs of a shrinking quantity in related rates', 'Changing the limits in a u-substitution', 'The inside derivative in the chain rule'],
  },
  // RedPen against apps that produce a worked solution for you. No product names here: describe, do not attack.
  compare: {
    them: 'Apps that work it out for you',
    us: 'RedPen',
    rows: [
      ['Read the question', 'Reads your working'],
      ['Hand you a finished solution', 'Finds the first line that lost points'],
      ['No score', 'Scores it like your exam, partial credit included'],
      ['You copy it', 'You fix it yourself, then try a similar one'],
    ],
  },
  scoring: {
    title: 'One missing 2x. Not a zero.',
    sub: 'University calculus exams give partial credit for the working, not only the last line. Practice exams will score every problem point by point, so you can see what one slip really costs, and what it does not.',
    label: 'Example: how one problem will be scored.',
    question: 'Problem 3 (3 points). y = sin(x²). Find dy/dx at x = √π.',
    columns: ['Point', 'Result', 'Why'],
    rows: [
      { point: 'Chain rule', result: '0 / 1', why: 'wrote cos(x²): the 2x from the inside is missing' },
      { point: 'Substitutes x = √π', result: '1 / 1', why: 'right for the derivative you wrote' },
      { point: 'Final value', result: '1 / 1', why: 'follows from your line, so the point is carried' },
    ],
    total: '2 of 3 points',
    contrast: 'A checker that only looks at the last line would give this 0 of 3.',
  },
  coverage: {
    sub: 'Not just Calculus I. The whole sequence, from your first limit to Stokes\' theorem: open any unit to see every topic.',
    courses: SYLLABUS,
  },
  trust: {
    points: [
      'In practice exams, a computer algebra system will check every step. A line is marked wrong only when it is proven wrong.',
      'We will publish how often RedPen agrees with a human calculus grader before anyone pays.',
      'For practice only. It marks working you wrote, and it will not do graded problem sets for you.',
      'Your work is never sold or used for advertising.',
    ],
  },
  pricing: {
    free: 'Your first marked practice exam is free.',
    then: 'After that, one price for the whole semester:',
    pass: '$49',
    passLabel: 'semester pass',
    perWeek: 'About $3 a week over a 16-week semester.',
    monthly: '$14.99',
    monthlyLabel: 'a month instead, cancel in one click',
    note: 'These are the prices for when practice exams open. Nothing to pay today.',
    cta: 'Get my free marked exam',
  },
  faq: [
    { q: 'Is this against my honor code?', a: 'RedPen is for exam practice. It marks working you have already written on practice questions and points to the step that went wrong instead of handing over the result. Do not use it on graded problem sets, and check your course policy if you are unsure.' },
    { q: 'How is this different from ChatGPT or Photomath?', a: 'Those are built to produce a worked solution for a question. RedPen is built to grade: it reads the working you wrote, finds the first line that lost points, scores the problem with partial credit the way your exam will, and explains that one step.' },
    { q: 'Can it read my handwriting?', a: 'Try it on the challenge at the top of this page: that is the same reading the practice exams will use. If it cannot make out a line, it says so and asks you to rewrite it, instead of guessing.' },
    { q: 'Does it work on my phone or iPad?', a: 'Yes. It runs in the browser on a phone, tablet or laptop. A tablet with a stylus feels closest to writing on paper.' },
    { q: 'Which courses does it cover?', a: 'The whole calculus sequence: Calculus I, Calculus II (integration techniques, series, parametric and polar), multivariable and vector calculus, and first differential equations. The full list of topics is in What it covers, above.' },
    { q: 'My course moves fast. Is this too basic?', a: 'The demo questions are the kind a first midterm asks. Practice exams will run up to final-exam level, with longer multi-part problems scored point by point the way a university exam is.' },
    { q: 'When does it open?', a: 'The demo on this page works today. Practice exams are being built now, and we are aiming to open them before fall 2026 finals. People on the list hear first.' },
    { q: 'What will it cost?', a: 'Your first marked practice exam is free. After that we plan a $49 semester pass, or $14.99 a month. Nothing is charged today.' },
    { q: 'What happens to my work?', a: 'On this page, nothing you write is stored. When practice exams open, your work will be kept only to show you your results, never sold, and you will be able to delete it at any time.' },
  ],
  waitlist: {
    sub: 'Tell us when it is, and leave your email. When practice exams open, your first marked one is free, and we will time our emails to land before your midterms and finals. Unsubscribe any time.',
    email: 'Email address',
    course: 'Course',
    school: 'University (optional)',
    examDate: 'Next exam date (optional)',
    button: 'Get my free marked exam',
    sent: 'Check your inbox to confirm.',
    expired: 'Your session expired. Refresh the page and try again.',
    failed: 'Something went wrong. Please try again.',
    confirmed: "You're on the list. Thank you!",
    invalid: 'That confirmation link has expired. Please join again.',
  },
  footer: 'RedPen Maths is built by DefyScale.',
} as const;
