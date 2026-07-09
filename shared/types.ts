// Domain types shared between the API server and the React client.

import type { GradeScale, GradeBand } from "./grades.ts";
export type { GradeScale, GradeBand } from "./grades.ts";

export type Role = "candidate" | "admin" | "facilitator" | "proctor";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  avatarUrl?: string;
  // Optional student-profile fields (managed in the Students table).
  gender?: string;
  age?: number | null;
  studentClass?: string;
  phone?: string;
  /** Accommodation: extra minutes added to every exam deadline for this student. */
  accommodationsExtraMinutes?: number;
  // Consecutive-day activity streak (days the student opened their portal).
  streak?: number;
  lastActiveDay?: string | null; // UTC YYYY-MM-DD of the most recent active day
  /** Per-channel notification preferences (self-managed in account settings). */
  notificationPrefs?: NotificationPrefs;
  // ── Two-factor authentication (TOTP authenticator app) ──
  twoFactorEnabled?: boolean;
  /** Active base32 secret (server-only, never sent to the client). Encrypted at
   *  rest with DATA_ENCRYPTION_KEY when configured — this is a long-lived
   *  credential equivalent to a password, so a DB leak must not hand over every
   *  user's second factor in plaintext. */
  twoFactorSecret?: string | null;
  /** Secret awaiting first-code confirmation during setup. Same at-rest encryption as twoFactorSecret. */
  twoFactorPending?: string | null;
  twoFactorBackupCodes?: string[];   // bcrypt-hashed one-time recovery codes
  /** The 30s TOTP step index of the last code accepted at login, so a captured
   *  code can't be replayed a second time within its validity window. */
  twoFactorLastStep?: number | null;
  /** Session epoch: bumped to invalidate all existing tokens for this user
   *  (logout, password change, admin reset). Tokens carry the value they were
   *  issued with; a mismatch means the session has been revoked. */
  tokenVersion?: number;
}

export interface NotificationPrefs {
  announcements?: boolean;
  results?: boolean;
  reminders?: boolean;
}

export type QuestionType =
  | "mcq"          // single correct choice
  | "multi_select" // multiple correct choices (all-or-nothing)
  | "true_false"
  | "short"        // short text, auto-graded against accepted answers
  | "numeric"      // number, auto-graded within a tolerance
  | "essay"        // long text, manually graded
  | "code"         // code, manually graded
  | "matching"     // match each left prompt to its correct right value
  | "ordering"     // arrange items into the correct sequence
  | "cloze"        // fill-in-the-blank(s) — ___ markers in the prompt
  | "hotspot"      // click the correct region of an image
  | "file_upload"  // upload a file as the answer — manually graded
  | "parameterized"; // numeric, with random per-candidate variables substituted into the prompt

export interface Question {
  id: string;
  examId: string;
  type: QuestionType;
  prompt: string;
  options?: string[]; // for mcq / multi_select / true_false
  correctAnswer: string; // option text, "true"/"false", numeric value, or accepted short answer
  /** Extra accepted answers for short-response questions (case-insensitive). */
  acceptedAnswers?: string[];
  /** Correct option set for multi_select (all must be picked, none extra). */
  correctAnswers?: string[];
  /** Accepted +/- tolerance for numeric questions (default 0 = exact). */
  tolerance?: number;
  /** Rubric for manually-graded (essay/code) questions. When set, points = sum of criteria. */
  rubric?: RubricCriterion[];
  /** Section this question belongs to (null/undefined = ungrouped). */
  sectionId?: string | null;
  /** Authoring difficulty label (organisational; shown in the builder). */
  difficulty?: "easy" | "medium" | "hard";
  /** Explanation shown to candidates after their result is released (the "why"). */
  explanation?: string;
  /** Topic tags — drive blueprint assembly, bank filtering and item grouping. */
  tags?: string[];
  /** Matching pairs — each left prompt maps to its correct right value. */
  matchPairs?: { left: string; right: string }[];
  /** Ordering — the items written in their CORRECT sequence (served shuffled). */
  sequence?: string[];
  /** Cloze — accepted answers for each blank, in order (blanks are `___` in the prompt). */
  blanks?: string[][];
  /** Hotspot — background image (data URL) the candidate clicks on. */
  imageUrl?: string;
  /** Hotspot — correct regions as %-rectangles {x,y,w,h} (0..100). A click inside any one scores. */
  hotspots?: { x: number; y: number; w: number; h: number }[];
  points: number;
  /** Last edit time (ISO). If a question is edited after an attempt started,
   *  that question's answer is voided (recorded blank) at submission. */
  updatedAt?: string;
  /** Language for `code` questions (used by the Monaco editor + runner). */
  codeLanguage?: string;
  /** Starter code shown in the editor for `code` questions. */
  starterCode?: string;
  /** Test cases for `code` questions: stdin → expected stdout (trimmed compare). */
  testCases?: { input: string; expected: string }[];
  /** Parameterized — variables randomised per candidate and substituted into the prompt as {name}. */
  paramVariables?: { name: string; min: number; max: number; decimals: number }[];
  /** Parameterized — formula (in the variable names) used to compute the correct answer, e.g. "d/t". */
  paramFormula?: string;
  /** Parameterized — accepted +/- tolerance on the computed answer (default 0 = exact). */
  paramTolerance?: number;
}

export interface RubricCriterion {
  id: string;
  label: string;
  maxPoints: number;
}

/** Per-exam lockdown rules an institution can toggle. */
export interface LockdownConfig {
  fullscreen: boolean;        // require fullscreen, block exam when exited
  blockCopyPaste: boolean;    // disable copy/cut/paste/selection/right-click
  blockShortcuts: boolean;    // block risky keyboard shortcuts (devtools, print, etc.)
  tabSwitchDetection: boolean;// flag tab switches / focus loss / minimise
  blockSecondScreen?: boolean;// block the exam when a second / extended display is detected (vs flag-only)
  webcam: boolean;            // require camera for proctoring
  faceMonitoring: boolean;    // continuous face-presence checks
  requireIdentity: boolean;   // collect student ID / registration number at check-in
  requireIdDocument?: boolean;// capture a photo of a physical photo-ID at check-in for the proctor to verify
  audioMonitoring?: boolean;  // listen for sustained talking/noise during the exam and flag it
  requireRoomScan?: boolean;  // capture a short webcam room scan at check-in for the proctor
  requireAgreement: boolean;  // require accepting exam rules + integrity policy
  violationLimit: number;     // auto-submit after N violations (0 = never auto-submit)

  // ── Safe Exam Browser (hard, OS-level lockdown) ──
  // When on, the exam can ONLY be taken inside Safe Exam Browser: the server
  // rejects any attempt/answer/submit request that doesn't carry a valid SEB
  // Config Key or Browser Exam Key hash. This is what actually prevents
  // screenshots/screen-recording/app-switching, which a web page alone cannot.
  requireSafeExamBrowser?: boolean;
  /** Config Key(s) from the SEB Config Tool (SHA256 hex). Any one matching passes. */
  sebConfigKeys?: string[];
  /** Optional Browser Exam Key(s) (SHA256 hex) — pins to a specific SEB build. */
  sebBrowserExamKeys?: string[];
  /** Link that launches this exam in SEB — a `seb(s)://` URL or an https link to the `.seb` config file. */
  sebLaunchUrl?: string;
}

export const DEFAULT_LOCKDOWN: LockdownConfig = {
  fullscreen: true,
  blockCopyPaste: true,
  blockShortcuts: true,
  tabSwitchDetection: true,
  blockSecondScreen: true,
  webcam: true,
  faceMonitoring: true,
  requireIdentity: true,
  requireAgreement: true,
  violationLimit: 2,
  requireSafeExamBrowser: false,
  sebConfigKeys: [],
  sebBrowserExamKeys: [],
  sebLaunchUrl: "",
};

export interface Exam {
  id: string;
  title: string;
  code: string;
  description: string;
  durationMinutes: number;
  passingScore: number; // percentage
  proctored: boolean;
  status: "draft" | "published";
  /** Practice exams are self-assessment only — ungraded toward records, no certificate. */
  practice?: boolean;
  /** "open" = every candidate sees it; "assigned" = only assigned candidates. */
  enrollment: "open" | "assigned";
  lockdown: LockdownConfig;
  /** Subject this exam belongs to (used to group analytics & exam listings). */
  subject?: string;
  /** Optional cover image (data URL) shown on exam cards. */
  coverImage?: string | null;
  /** Study materials / resources surfaced to candidates on the exam page. */
  resources?: { label: string; url: string }[];
  /** Optional availability window set in the Scheduler (ISO datetimes). */
  availableFrom?: string | null;
  availableUntil?: string | null;
  // ── Question delivery (per-attempt randomization) ──
  /** Shuffle question order per attempt (default true). */
  shuffleQuestions?: boolean;
  /** Shuffle answer-option order per attempt (default true). */
  shuffleOptions?: boolean;
  /** Draw a random subset of this many questions per attempt (null/0 = serve all). */
  questionsPerAttempt?: number | null;
  // ── Marking scheme ──
  /** Fraction of a question's points deducted for a wrong objective answer (0 = off). */
  negativeMarking?: number;
  /** Award proportional partial credit on multi-select questions. */
  partialCredit?: boolean;
  // ── Grade scaling & boundaries ──
  /** Curve applied to every raw score on this exam (add points / multiply factor). */
  gradeScale?: GradeScale;
  /** Letter-grade boundaries (e.g. A ≥ 80). Empty = no letter grades. */
  gradeBands?: GradeBand[];
  /** Scheduled result release: students can't see scores until this time (ISO). */
  resultsReleaseAt?: string | null;
  /** Hide candidate identity from graders while marking (revealed once released). */
  anonymousGrading?: boolean;
  // ── Sections (optional grouping of questions) ──
  sections?: ExamSection[];
  /** Blueprint: auto-assemble each attempt by drawing N questions per topic tag.
   *  When set (non-empty), it overrides plain question-pool drawing. */
  blueprint?: { tag: string; count: number }[];
  createdAt: string;
}

export interface ExamSection {
  id: string;
  title: string;
  instructions?: string;
  /** Question pool: serve this many randomly-drawn questions from the section per attempt (0/undefined = serve all). */
  drawCount?: number;
  /** Suggested time budget for this section, in minutes (shown to candidates; advisory). */
  timeLimitMinutes?: number;
}

export type RegistrationStatus =
  | "registered"
  | "checked_in"
  | "in_progress"
  | "submitted";

/** Admin confirmation state — a candidate may only sit an exam when "confirmed". */
export type ApprovalStatus = "pending" | "confirmed" | "rejected";

export interface Registration {
  id: string;
  examId: string;
  candidateId: string;
  status: RegistrationStatus;
  approval: ApprovalStatus;
  scheduledStart: string | null;
  systemCheckPassed: boolean;
  studentRef?: string | null;     // student ID / registration number captured at check-in
  rulesAcceptedAt?: string | null; // when the candidate accepted the rules + policies
  verificationPhoto?: string | null; // webcam photo captured at check-in (data URL)
  idDocumentPhoto?: string | null;  // photo of the candidate's ID document, captured/uploaded at check-in (data URL)
  idVerified?: boolean;             // a proctor confirmed the ID matches the candidate
  idVerifiedBy?: string | null;     // name of the staff member who verified the ID
  idVerifiedAt?: string | null;     // when the ID was verified
  roomScanPhotos?: string[];        // short webcam room-scan frames captured at check-in (data URLs)
  checkedInAt?: string | null;    // when the candidate completed system check-in (attendance)
  createdAt?: string;             // when the registration was created
  remindersSent?: string[];       // which scheduled reminders have already gone out ("24h","1h")
  /** Set when the candidate failed to start within the grace window after the scheduled start. */
  flaggedLate?: boolean;
  /** Human-readable late note, e.g. "was 30 min late". */
  lateReason?: string | null;
}

export type AttemptStatus = "in_progress" | "submitted";

/**
 * Where an attempt sits in the grading lifecycle:
 *  - "auto_graded": every question was machine-gradeable; score is final and visible.
 *  - "pending_review": one or more short answers need a human grade; score is
 *      provisional and hidden from the candidate; no certificate yet.
 *  - "released": a grader finished manual marking and published the result.
 */
export type GradingStatus = "auto_graded" | "pending_review" | "released";

export interface Attempt {
  id: string;
  registrationId: string;
  examId: string;
  candidateId: string;
  startedAt: string;
  submittedAt: string | null;
  durationMinutes: number;
  score: number | null; // percentage (provisional while pending_review); curved if the exam has a grade scale
  /** Raw (uncurved) percentage, kept for transparency when a grade scale is applied. */
  rawScore?: number | null;
  passed: boolean | null;
  status: AttemptStatus;
  gradingStatus?: GradingStatus;
  releasedAt?: string | null;
  /** Independent second-marker score, recorded for reconciliation/double-blind grading. */
  secondMark?: { graderId: string; graderName: string; score: number; at: string } | null;
  // ── Live proctor intervention ──
  /** Whether a proctor has paused this attempt (timer frozen, candidate locked out). */
  paused?: boolean;
  /** When the current pause began (ISO); null when not paused. */
  pausedAt?: string | null;
  /** Accumulated paused time (ms), added to the deadline so paused time isn't lost. */
  pausedMs?: number;
  /** Set when a proctor force-submitted the attempt. */
  terminated?: boolean;
  terminationReason?: string | null;
  /** Messages a proctor has sent to the candidate during the attempt. */
  proctorMessages?: { id: string; text: string; at: string }[];
  // ── Per-attempt question delivery (frozen at start so resume is stable) ──
  /** The exact question ids served to this attempt, in served order. */
  questionIds?: string[];
  /** Per-question option order as served (option strings). */
  optionOrders?: Record<string, string[]>;
  /** Parameterized — frozen random variable values per question: questionId → { varName → value }. */
  paramValues?: Record<string, Record<string, number>>;
}

export interface Answer {
  id: string;
  attemptId: string;
  questionId: string;
  value: string;
  correct: boolean | null;
  /** Points actually awarded (supports partial credit + manual grading). */
  awardedPoints?: number | null;
  /** Set when a short answer didn't auto-match and awaits a human grade. */
  needsReview?: boolean;
  /** How the points were assigned. */
  gradedBy?: "auto" | "manual" | null;
  /** Optional grader note, shown to the candidate once results are released. */
  feedback?: string | null;
  /** Per-criterion points for rubric-graded answers (criterionId → points). */
  rubricScores?: Record<string, number>;
}

/** The complete set of proctoring event types the client may report. Used both as
 *  the source of the `ProctorEventType` union and as a runtime allowlist when
 *  validating candidate-submitted events on the server. */
export const PROCTOR_EVENT_TYPES = [
  "face_missing",
  "multiple_faces",
  "tab_blur",
  "fullscreen_exit",
  "system_check",
  "copy_attempt",
  "paste_attempt",
  "screenshot_attempt",
  "screen_capture",
  "incognito",
  "shortcut_blocked",
  "audio_noise",
  "multi_monitor",
] as const;

export type ProctorEventType = (typeof PROCTOR_EVENT_TYPES)[number];

export type Severity = "info" | "warning" | "high";

export interface ProctorEvent {
  id: string;
  attemptId: string;
  type: ProctorEventType;
  severity: Severity;
  message: string;
  at: string;
}

/** A webcam frame captured during a proctored attempt. A rolling series is kept per attempt. */
export interface Snapshot {
  id: string;
  attemptId: string;
  dataUrl: string; // small JPEG data URL
  at: string;
}

export interface Certificate {
  id: string;
  certNumber: string;
  attemptId: string;
  candidateId: string;
  examId: string;
  score: number;
  issuedAt: string;
}

/** A message recorded by the mailer — viewable in the admin outbox. */
export interface EmailMessage {
  id: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
  /** Outcome: "logged" (mock), "sent" (delivered by a real transport), or "failed". */
  delivery?: "logged" | "sent" | "failed";
  error?: string | null;
  provider?: string; // "mock" | "smtp" | "ethereal"
}

export type AnnouncementAudience = "everyone" | "students" | "instructors" | "admins";
export type AnnouncementPriority = "normal" | "high" | "urgent";
export type AnnouncementChannel = "in_app" | "email" | "sms" | "whatsapp";
export type AnnouncementStatus = "draft" | "scheduled" | "sent";

/** An institution-wide announcement, optionally scheduled and delivered over channels. */
export interface Announcement {
  id: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  priority: AnnouncementPriority;
  channels: AnnouncementChannel[];
  status: AnnouncementStatus;
  scheduledFor?: string | null;
  createdAt: string;
  sentAt?: string | null;
  emailedCount?: number; // recipients actually emailed (when the email channel is on)
  createdBy?: string;
  /** Pinned announcements float to the top of the recipient's feed. */
  pinned?: boolean;
  /** Free-text sender department/office (e.g. "IT Services", "Registrar") — displayed as a tag, not tied to the Faculty/Department org entities. */
  department?: string;
}

/** Per-student read receipt for an announcement — drives unread badges/dots
 *  and the "mark as read" affordance. Only candidates read via this feed
 *  today, so this is candidate-scoped. */
export interface AnnouncementRead {
  id: string;
  announcementId: string;
  candidateId: string;
  readAt: string;
}

/** Institution-wide settings (a single record). Some fields drive real behavior. */
export interface OrgSettings {
  id: string; // always "org"
  name: string;
  supportEmail: string;
  website: string;
  timezone: string;
  defaultPassingScore: number;   // default for new exams
  defaultProctored: boolean;     // default for new exams
  autoConfirmEnrollment: boolean; // open-exam auto-enrollments are confirmed immediately
  type?: string;                 // University, College, …
  accreditation?: string;
  phone?: string;
  address?: string;
  plan?: string;                 // display-only subscription tier
  /** Reusable named rubrics a grader can save once and apply to essay/code questions. */
  rubricLibrary?: { id: string; name: string; criteria: RubricCriterion[] }[];
  /** Cadence for the admin summary email digest. */
  digestFrequency?: "off" | "daily" | "weekly";
  /** Auto-purge audit logs older than this many days (0/undefined = keep forever). */
  auditRetentionDays?: number;
  /** When the last digest was emailed (ISO) — drives the scheduler. */
  digestLastSentAt?: string | null;
  /** Also send exam reminders by SMS/WhatsApp (requires an SMS provider configured server-side). */
  smsReminders?: boolean;
  /** Outbound webhooks — POST a signed JSON payload to each URL when subscribed events fire. */
  webhooks?: Webhook[];
  /** Public read-only API keys (only a hash is stored; the secret is shown once on creation). */
  apiKeys?: ApiKeyRecord[];
  /** Scheduled report exports emailed on a cadence. */
  scheduledReports?: ScheduledReport[];
  /** How this institution organizes learning — see LearningStructureConfig.
   *  Always present after initDb's backfill; optional in the type only
   *  because older in-memory records predate this field. */
  learningStructure?: LearningStructureConfig;
}

// ---- Learning structure (foundational config layer — see the "Learning
// structure abstraction" project note) ----
export const LEARNING_STRUCTURE_MODES = ["academic", "cohort", "hybrid"] as const;
export type LearningStructureMode = (typeof LEARNING_STRUCTURE_MODES)[number];

/** Drives which structural concepts (academic years/semesters/levels vs.
 *  cohorts) are active for this institution, and what to call them in the UI.
 *  This is the foundational config layer for Oriole's main driving
 *  architecture goal: every module that touches terms/levels/cohorts should
 *  read this instead of hardcoding one structure. Not yet consumed by any
 *  existing module — those are migrated to it incrementally, module by
 *  module, rather than all at once. */
export interface LearningStructureConfig {
  mode: LearningStructureMode;
  useAcademicYears: boolean;
  useSemesters: boolean;
  useLevels: boolean;
  useCohorts: boolean;
  /** UI terminology overrides, since institutions name these differently
   *  (a university says "Semester", a bootcamp might say "Sprint"). */
  academicYearLabel: string;
  semesterLabel: string;
  levelLabel: string;
  cohortLabel: string;
}

export const DEFAULT_LEARNING_STRUCTURE: LearningStructureConfig = {
  mode: "academic",
  useAcademicYears: true, useSemesters: true, useLevels: true, useCohorts: true,
  academicYearLabel: "Academic Year", semesterLabel: "Semester", levelLabel: "Level", cohortLabel: "Class",
};

/** An outbound webhook subscription. */
export interface Webhook {
  id: string;
  url: string;
  events: string[];          // e.g. ["attempt.submitted", "result.released", "certificate.issued"]
  secret: string;            // used to sign payloads (HMAC-SHA256, header x-orcalis-signature)
  active: boolean;
  createdAt: string;
  lastStatus?: number | null; // HTTP status of the most recent delivery
  lastAt?: string | null;
}

/** A public API key. Only `keyHash` is persisted; the raw key is returned once at creation. */
export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;            // first chars, shown for identification (e.g. "ok_live_a1b2")
  keyHash: string;           // sha256 of the full key
  createdAt: string;
  lastUsedAt?: string | null;
}

/** A scheduled report export emailed to recipients on a cadence. */
export interface ScheduledReport {
  id: string;
  reportKey: "results" | "students" | "certificates";
  frequency: "daily" | "weekly";
  recipients: string[];
  lastSentAt?: string | null;
}

/** The canonical set of webhook event names. */
export const WEBHOOK_EVENTS = ["attempt.submitted", "result.released", "certificate.issued", "exam.published"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** A class/cohort of students (Teams-style). Exams are assigned to the whole class at a scheduled time. */
export interface ClassGroup {
  id: string;
  name: string;
  code?: string;
  description?: string;
  memberIds: string[];
  assignments: { examId: string; scheduledStart: string | null; assignedAt: string }[];
  createdAt: string;
}

// ---- Digital library (Digital Learning Resource Management) ----
export const BOOK_GENRES = ["Novel", "Fiction", "Science fiction", "Fantasy", "Historical fiction", "Mystery", "Thriller", "Horror"] as const;
export type BookGenre = (typeof BOOK_GENRES)[number];

/** What kind of academic resource this is. "eBook" covers the original
 *  recreational-reading use case (genre applies only to this type). */
export const RESOURCE_TYPES = [
  "Textbook", "Lecture Notes", "Past Questions", "Video", "Audio", "Assignment Guide", "Lab Manual",
  "Research Paper", "Journal", "Presentation", "Source Code", "ZIP Resources", "External Link", "eBook",
  "Policy Document", "Course Outline", "Other",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"] as const;
export type ResourceDifficulty = (typeof RESOURCE_DIFFICULTIES)[number];

/** Who can see a resource. "institution" = every student; "scoped" = only
 *  students in `classIds` (via ClassGroup.memberIds) or listed directly in
 *  `studentIds` — the only real enrollment primitive this app has. Faculty/
 *  department/programme/course/level are descriptive metadata on the resource
 *  itself (for search & browsing), not access-control gates, since User has
 *  no faculty/department/programme fields to check against. */
export interface ResourceVisibility {
  scope: "institution" | "scoped";
  classIds: string[];
  studentIds: string[];
}

/** A learning resource (book, lecture notes, past questions, video link, etc.)
 *  an admin/facilitator has added to the library. `coverImage` follows the
 *  same convention as Exam.coverImage (a validated data: URL, no separate
 *  file storage). `fileData` is the uploaded document itself (also a data:
 *  URL, same no-separate-storage convention, just a higher size cap) — when
 *  it's a PDF, totalPages is auto-detected from it server-side. `externalUrl`
 *  is an optional link instead of/alongside an upload (the recommended way to
 *  reference full lecture-length video, since direct upload is capped by the
 *  data-URL storage model). There is no in-app reader/viewer — "Read" opens
 *  fileData or externalUrl in a new tab. `checksum` (SHA-256 of fileData) is
 *  used for duplicate-upload detection. Faculty/department/programme names are
 *  denormalized from the org entities at save time so students never need a
 *  join. `version` increments on every file replacement; prior versions are
 *  kept in the resourceVersions table. */
export interface Book {
  id: string;
  title: string;
  author: string;
  genre: BookGenre;
  resourceType: ResourceType;
  coverImage?: string | null;
  fileData?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
  checksum?: string | null;
  externalUrl?: string | null;
  totalPages: number;
  pagesAutoDetected?: boolean;
  description?: string;
  summary?: string;
  tags?: string[];
  academicYearId?: string | null;
  academicYearName?: string | null;
  semester?: string;
  facultyId?: string | null;
  facultyName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  programId?: string | null;
  programName?: string | null;
  course?: string;
  courseCode?: string;
  level?: string;
  instructor?: string;
  publisher?: string;
  edition?: string;
  isbn?: string;
  language?: string;
  difficulty?: ResourceDifficulty | null;
  estimatedReadingTime?: number | null;
  visibility: ResourceVisibility;
  status: "draft" | "published";
  availableFrom?: string | null;
  availableUntil?: string | null;
  canDownload: boolean;
  canPreview: boolean;
  downloadLimit?: number | null;
  watermarkPdf?: boolean;
  version: number;
  viewCount: number;
  downloadCount: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt?: string;
}

/** A prior file snapshot of a Book, kept whenever the file is replaced so
 *  admins can view history / restore, while students always see the latest. */
export interface ResourceVersion {
  id: string;
  bookId: string;
  version: number;
  fileData?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
  checksum?: string | null;
  changeLog?: string;
  uploadedBy: string;
  createdAt: string;
}

export interface ResourceBookmark {
  id: string;
  bookId: string;
  candidateId: string;
  createdAt: string;
}

export interface ResourceRating {
  id: string;
  bookId: string;
  candidateId: string;
  score: number; // 1-5
  comment?: string;
  createdAt: string;
}

/** One row per successful download, used only to enforce per-student
 *  downloadLimit — not a full audit entry (too high-volume for the
 *  tamper-evident audit_logs chain). */
export interface ResourceDownloadLog {
  id: string;
  bookId: string;
  candidateId: string;
  at: string;
}

/** One student's reading position in one book. currentPage/percentage are
 *  set by the student directly (there's no reader to auto-track pages). */
export interface ReadingProgress {
  id: string;
  bookId: string;
  candidateId: string;
  currentPage: number;
  updatedAt: string;
}

// ---- Institution structure ----
export interface Faculty { id: string; name: string; createdAt: string; }
export interface Department { id: string; name: string; facultyId?: string | null; createdAt: string; }
export interface Program { id: string; name: string; departmentId?: string | null; level?: string; createdAt: string; }
export interface Campus { id: string; name: string; location?: string; createdAt: string; }
export interface AcademicYear { id: string; name: string; startDate?: string | null; endDate?: string | null; current?: boolean; createdAt: string; }

/** Per-subject performance trend for one student. */
export interface SubjectTrend {
  subject: string;
  attempts: number;
  avg: number;
  best: number;
  first: number;
  last: number;
  slope: number;            // least-squares points-per-exam; 0 when a single sitting
  trend: "improving" | "steady" | "declining" | "single";
  scores: number[];         // chronological scores, for the sparkline
}
/** A student's cross-subject trend infographic data. */
export interface StudentTrend {
  points: { score: number; at: string | null; subject: string; examTitle: string }[];
  overall: { trend: "up" | "flat" | "down"; delta: number }; // delta = 2nd-half avg minus 1st-half avg
  subjects: SubjectTrend[];
  summary: string;
}

export type RegradeStatus = "open" | "resolved" | "rejected";
/** A student's request to have a released result reviewed, routed to a grader. */
export interface RegradeRequest {
  id: string;
  attemptId: string;
  candidateId: string;
  examId: string;
  reason: string;
  status: RegradeStatus;
  response?: string | null;     // grader's written outcome
  scoreBefore?: number | null;
  scoreAfter?: number | null;   // set if the grade was adjusted
  createdAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;   // grader name
}

/** A recorded administrative action for the audit trail. */
export interface AuditLog {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string; // dot-namespaced, e.g. "exam.published"
  target: string; // human-readable description
  /** Tamper-evidence: sha256(prevHash + canonical(entry)), hash-chained to the prior entry. */
  hash?: string;
  prevHash?: string;
}

// ---- API response shapes ----

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatarUrl?: string;
  gender?: string;
  phone?: string;
  studentClass?: string;
  notificationPrefs?: NotificationPrefs;
  twoFactorEnabled?: boolean;
}

/** A question delivered to the candidate — never includes the correct answer. */
export interface PublicQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  points: number;
  sectionId?: string | null;
  // ── code questions ──
  codeLanguage?: string;
  starterCode?: string;
  /** Sample test cases the candidate can run against (visible by design). */
  testCases?: { input: string; expected: string }[];
  // ── matching / ordering / cloze / hotspot ──
  /** Matching — left-hand prompts. Answer = JSON array of chosen rights aligned to these. */
  matchPrompts?: string[];
  /** Cloze — number of blanks. Answer = JSON array of strings, one per blank. */
  blankCount?: number;
  /** Hotspot — image the candidate clicks. Answer = JSON {x,y} in % (0..100). */
  imageUrl?: string;
  /** Parameterized — the random variable values shown to this candidate (already substituted into prompt). */
  paramValues?: Record<string, number>;
}

export interface ExamListItem {
  registration: Registration;
  exam: Exam;
  attempt: Attempt | null;
  /** Question count for this exam — only populated by list endpoints that compute it cheaply (e.g. GET /api/exams). */
  questionCount?: number;
}
