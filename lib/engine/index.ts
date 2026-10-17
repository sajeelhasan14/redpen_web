// The Calc I marking engine. Callers use these three calls and the types:
//   readProblem  -> a transcript for the student to confirm (or a retake reason)
//   markProblem  -> points and line statuses for one problem
//   scoreExam    -> the exam total, with exam-wide penalties applied once
export { readProblem, type ReadOutcome } from './reader';
export { markProblem, unparsedLines, type MarkDeps } from './mark';
export { scoreExam } from './scorer';
export { EngineError, type EngineImage } from './model';
export { AP_DEFAULT } from './profiles';
export { parseQuestion } from './rubric';
export type * from './types';
