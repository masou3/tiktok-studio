import type { Caption, CaptionWord, Clip } from "./types";

export type PlacedClip = { clip: Clip; index: number; startMs: number; endMs: number };

/** Clips play back to back; each one's length is its durationMs. */
export function layoutClips(clips: Clip[]): PlacedClip[] {
  let t = 0;
  return clips.map((clip, index) => {
    const startMs = t;
    t += clip.durationMs;
    return { clip, index, startMs, endMs: t };
  });
}

export function clipsTotalMs(clips: Clip[]) {
  return clips.reduce((sum, c) => sum + c.durationMs, 0);
}

export function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Group spoken words into short TikTok-style captions (up to 3 words). */
export function buildCaptions(words: CaptionWord[], maxWords = 3): Caption[] {
  const out: Caption[] = [];
  let chunk: CaptionWord[] = [];
  const flush = () => {
    if (!chunk.length) return;
    out.push({
      id: `cap_${out.length}_${chunk[0].startMs}`,
      startMs: chunk[0].startMs,
      endMs: chunk[chunk.length - 1].endMs,
      text: chunk.map((w) => w.text).join(" "),
      words: chunk,
    });
    chunk = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (chunk.length && prev && w.startMs - prev.endMs > 450) flush();
    chunk.push(w);
    if (chunk.length >= maxWords || /[.!?,;:]$/.test(w.text)) flush();
  });
  flush();
  // Hold each caption until the next one starts, so the screen doesn't flicker.
  for (let i = 0; i < out.length - 1; i++) {
    const gap = out[i + 1].startMs - out[i].endMs;
    if (gap > 0 && gap < 600) out[i].endMs = out[i + 1].startMs;
  }
  return out;
}

export function captionAt(captions: Caption[], t: number) {
  return captions.find((c) => t >= c.startMs && t < c.endMs) ?? null;
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

export type LayerState = {
  visible: boolean;
  /** Position inside the source video, in ms. */
  localMs: number;
  style: { opacity: number; transform: string; zIndex: number };
};

/**
 * What one clip's video layer should show at timeline time t.
 * A clip's "transition in" plays over its first transitionMs, on top of the
 * previous clip, which keeps rolling underneath until the transition ends.
 */
export function layerAt(placed: PlacedClip[], i: number, t: number): LayerState {
  const p = placed[i];
  const next = placed[i + 1];
  const nextT = next && next.clip.transitionIn !== "cut" ? next.clip.transitionMs : 0;
  const visible = t >= p.startMs && t < p.endMs + nextT;
  const maxLocal = p.clip.trimStartMs + Math.max(0, p.clip.sourceDurationMs - 60);
  const localMs = Math.min(maxLocal, p.clip.trimStartMs + Math.max(0, t - p.startMs));

  let opacity = 1;
  let transform = "none";
  const T = p.clip.transitionMs;
  if (i > 0 && p.clip.transitionIn !== "cut" && t >= p.startMs && t < p.startMs + T) {
    const k = easeOut((t - p.startMs) / T);
    if (p.clip.transitionIn === "crossfade") opacity = k;
    if (p.clip.transitionIn === "slide") transform = `translateX(${(1 - k) * 100}%)`;
    if (p.clip.transitionIn === "zoom") {
      transform = `scale(${1.35 - 0.35 * k})`;
      opacity = Math.min(1, k * 2);
    }
  }
  return { visible, localMs, style: { opacity, transform, zIndex: i + 1 } };
}
