// lib/boards.ts: no server imports, so client components can use it.
export type Role = 'parent' | 'student';
// Exam boards belong to the paused UK pass; orders still carry one.
export type Board = 'AQA' | 'Edexcel' | 'OCR' | 'Not sure';
export const BOARDS: Board[] = ['AQA', 'Edexcel', 'OCR', 'Not sure'];

/** What a US university student on the list is taking. Later courses measure demand before they exist. */
export const COURSES = ['Calculus I', 'Calculus II', 'Multivariable Calculus', 'Differential Equations', 'Other'] as const;
export type Course = (typeof COURSES)[number];
