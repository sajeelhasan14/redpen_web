// Shared contract between the three layers of the POC:
//
//   page  (lib/page.ts)   - what is on the student's page: strokes, images, tutor marks
//   tutor (app/api/tutor) - looks at an image of the page, returns a TutorReply
//   ink   (lib/ink.ts)    - turns annotations into hand-drawn strokes
//
// The tutor never learns whether the image came from a canvas or a screenshot.
// Moving to a real desktop overlay means a new capture source and a new
// annotation surface; everything that talks in Annotation terms is unchanged.

export interface CoordinateSpace {
  width: number;
  height: number;
}

/** What the tutor is allowed to draw. Coordinates are in the capture's space. */
export type Annotation =
  | { kind: 'circle'; x: number; y: number; rx: number; ry: number }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'strike'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'write'; x: number; y: number; text: string; size?: 'small' | 'normal' | 'big' }
  | { kind: 'text'; x: number; y: number; text: string }
  // Diagram primitives: a straight line, a rectangle, and a free polyline
  // (triangles, axes, curves, number lines).
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'path'; pts: { x: number; y: number }[] }
  // Rings text the tutor itself wrote; the client resolves it to an exact circle.
  | { kind: 'ring'; text: string };

/** An axis-aligned box in page units. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where the tutor may write, computed by the client from the page model. */
export interface FreeRegion extends Box {
  where: 'left of it' | 'right of it' | 'below it' | 'above it' | 'the whole page';
  charsNormal: number;
  charsSmall: number;
}

export interface PageLayout {
  /** Box around everything the student drew or dropped in, or null on an empty page. */
  student: Box | null;
  /** Box around the tutor's own earlier ink, or null. */
  tutor: Box | null;
  free: FreeRegion[];
}

export type AnnotationKind = Annotation['kind'];

/** One beat of a lesson: what the tutor says while its pen writes. */
export interface LessonStep {
  say: string;
  write: Annotation[];
}

/** What comes back from /api/tutor. */
export interface TutorReply {
  /** false when the page holds a doodle, a stray mark, or writing still in progress. */
  worthResponding: boolean;
  /** true when the readable work has no error. Meaningless when worthResponding is false. */
  correct: boolean;
  /** Read aloud and shown in the status bar. Empty means say nothing. */
  speech: string;
  annotations: Annotation[];
  /** The model's private verification, kept for debugging and the fixture runner. */
  check?: string;
  /** Present for questions: a lesson to play step by step. speech/annotations are then empty. */
  steps?: LessonStep[];
}

/** A line of the recent spoken exchange, sent back so a question can refer to it. */
export interface TranscriptLine {
  who: 'student' | 'tutor';
  text: string;
}

export interface TutorRequest {
  dataUrl: string;
  space: CoordinateSpace;
  /** A spoken question. Absent for an automatic check. */
  question?: string;
  /** Marks the tutor has already burned into this page. */
  prior: Annotation[];
  transcript: TranscriptLine[];
  layout?: PageLayout;
}
