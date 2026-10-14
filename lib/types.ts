export type TransitionType = "cut" | "crossfade" | "slide" | "zoom" | "flash" | "whip" | "spin" | "glitch" | "slideL" | "slideU" | "slideD" | "whipL" | "whipU" | "whipD" | "burn";

export const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: "cut", label: "Cut" },
  { id: "crossfade", label: "Crossfade" },
  { id: "slide", label: "Slide" },
  { id: "zoom", label: "Zoom punch" },
  { id: "flash", label: "White flash" },
  { id: "whip", label: "Whip blur" },
  { id: "spin", label: "Spin zoom" },
  { id: "glitch", label: "Glitch" },
  { id: "slideL", label: "Slide left" },
  { id: "slideU", label: "Slide up" },
  { id: "slideD", label: "Slide down" },
  { id: "whipL", label: "Whip left" },
  { id: "whipU", label: "Whip up" },
  { id: "whipD", label: "Whip down" },
  { id: "burn", label: "Film burn" },
];

/** "image" is a still (like a brand end card) held for the clip length. */
export type ClipSource = "pexels" | "fal" | "image";

export type Clip = {
  id: string;
  projectId: string;
  order: number;
  /** Length of the clip on the timeline. */
  durationMs: number;
  /** Where in the source video the clip starts. */
  trimStartMs: number;
  /** Full length of the source video. */
  sourceDurationMs: number;
  source: ClipSource;
  transitionIn: TransitionType;
  transitionMs: number;
  pexelsVideoId: number;
  pexelsUrl: string;
  pexelsThumbnail: string;
  pexelsAuthor: string;
  pexelsWidth: number;
  pexelsHeight: number;
};

export type CaptionWord = { text: string; startMs: number; endMs: number };

export type Caption = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words: CaptionWord[];
};

export type CaptionStyle = "tiktok" | "bold" | "box" | "karaoke" | "neon";

/** Whole-video finish. Each value is 0 (off) to 100 (full). */
export type Look = {
  /** Film grain. */
  grain: number;
  /** Horizontal scanlines, like an old TV. */
  scanlines: number;
  /** Darkened corners. */
  vignette: number;
  /** Red/blue colour fringing. */
  rgb: number;
};

export const NO_LOOK: Look = { grain: 0, scanlines: 0, vignette: 0, rgb: 0 };

/** One-tap starting points for the Look controls. */
export const LOOK_PRESETS: { id: string; label: string; look: Look }[] = [
  { id: "clean", label: "Clean", look: NO_LOOK },
  { id: "vhs", label: "VHS", look: { grain: 35, scanlines: 55, vignette: 40, rgb: 45 } },
  { id: "film", label: "Film", look: { grain: 50, scanlines: 0, vignette: 55, rgb: 0 } },
];

export function cleanLook(v: unknown): Look {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => Math.min(100, Math.max(0, Math.round(typeof x === "number" ? x : 0)));
  return { grain: n(o.grain), scanlines: n(o.scanlines), vignette: n(o.vignette), rgb: n(o.rgb) };
}

/** A timed item dropped onto the effects lane, like a CapCut effect or filter. */
export type EffectType =
  | "push" | "pull" | "shake" | "flash" | "glitch" | "blur" | "rgb"
  | "vhs" | "camcorder" | "oldfilm" | "halation" | "lightleak" | "dream"
  | "cold" | "warm" | "bw" | "night";

export const EFFECTS: { id: EffectType; label: string; defaultMs: number; group: "motion" | "filter" }[] = [
  { id: "push", label: "Push in", defaultMs: 1200, group: "motion" },
  { id: "pull", label: "Pull out", defaultMs: 1200, group: "motion" },
  { id: "shake", label: "Shake", defaultMs: 700, group: "motion" },
  { id: "flash", label: "Flash", defaultMs: 350, group: "motion" },
  { id: "glitch", label: "Glitch", defaultMs: 400, group: "motion" },
  { id: "blur", label: "Blur pulse", defaultMs: 600, group: "motion" },
  { id: "rgb", label: "RGB split", defaultMs: 500, group: "motion" },
  { id: "vhs", label: "VHS tape", defaultMs: 2500, group: "filter" },
  { id: "camcorder", label: "Camcorder", defaultMs: 2500, group: "filter" },
  { id: "oldfilm", label: "Old film", defaultMs: 2500, group: "filter" },
  { id: "halation", label: "Red glow", defaultMs: 2500, group: "filter" },
  { id: "lightleak", label: "Light leak", defaultMs: 2000, group: "filter" },
  { id: "dream", label: "Dreamy glow", defaultMs: 2500, group: "filter" },
  { id: "cold", label: "Cold teal", defaultMs: 3000, group: "filter" },
  { id: "warm", label: "Warm", defaultMs: 3000, group: "filter" },
  { id: "bw", label: "Black and white", defaultMs: 3000, group: "filter" },
  { id: "night", label: "Night blue", defaultMs: 3000, group: "filter" },
];

export type Effect = {
  id: string;
  type: EffectType;
  startMs: number;
  durationMs: number;
  /** 10 (gentle) to 100 (hard) */
  strength: number;
};

const EFFECT_IDS = EFFECTS.map((e) => e.id as string);

export function cleanEffects(v: unknown): Effect[] {
  if (!Array.isArray(v)) return [];
  const out: Effect[] = [];
  for (const raw of v.slice(0, 80)) {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (typeof o.type !== "string" || !EFFECT_IDS.includes(o.type)) continue;
    const num = (x: unknown, d: number) => (typeof x === "number" && isFinite(x) ? x : d);
    out.push({
      id: typeof o.id === "string" && o.id ? o.id.slice(0, 40) : `fx_${out.length}_${Math.random().toString(36).slice(2, 8)}`,
      type: o.type as EffectType,
      startMs: Math.max(0, Math.round(num(o.startMs, 0))),
      durationMs: Math.min(60000, Math.max(100, Math.round(num(o.durationMs, 500)))),
      strength: Math.min(100, Math.max(10, Math.round(num(o.strength, 60)))),
    });
  }
  return out;
}

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type Project = {
  id: string;
  title: string;
  aspect: "9:16";
  fps: 30;
  width: 1080;
  height: 1920;
  durationMs: number;
  status: "draft" | "rendering" | "exported";
  aiDisclosure: boolean;
  hashtags: string[];
  clips: Clip[];
  voiceoverScript: string;
  voiceoverUrl: string;
  musicUrl: string;
  musicName: string;
  /** 0 to 100 */
  musicVolume: number;
  /** Music fade-out length in ms; 0 means no fade. */
  musicFadeMs: number;
  captions: Caption[];
  captionStyle: CaptionStyle;
  look: Look;
  effects: Effect[];
  budgetCents: number;
  spentCents: number;
  createdAt: string;
  updatedAt: string;
};


/** What the home screen needs to draw a project card, without the heavy voiceover and caption data. */
export type ProjectCard = {
  id: string;
  title: string;
  updatedAt: string;
  spentCents: number;
  clipCount: number;
  durationMs: number;
  hasVoice: boolean;
  /** The first clip, used for the thumbnail. */
  thumb: { kind: "image" | "video"; url: string } | null;
};

/** An AI clip saved for reuse across projects. */
export type LibraryClip = {
  id: string;
  url: string;
  label: string;
  durationMs: number;
  createdAt: string;
};
