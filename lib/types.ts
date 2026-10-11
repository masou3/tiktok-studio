export type TransitionType = "cut" | "crossfade" | "slide" | "zoom";

export const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: "cut", label: "Cut" },
  { id: "crossfade", label: "Crossfade" },
  { id: "slide", label: "Slide" },
  { id: "zoom", label: "Zoom punch" },
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

export type CaptionStyle = "tiktok" | "bold" | "box" | "karaoke";

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
  budgetCents: number;
  spentCents: number;
  createdAt: string;
  updatedAt: string;
};
