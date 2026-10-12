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
  style: { opacity: number; transform: string; filter: string; zIndex: number };
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
  let filter = "none";
  const T = p.clip.transitionMs;
  if (i > 0 && p.clip.transitionIn !== "cut" && t >= p.startMs && t < p.startMs + T) {
    const k = easeOut((t - p.startMs) / T);
    if (p.clip.transitionIn === "crossfade") opacity = k;
    if (p.clip.transitionIn === "slide") transform = `translateX(${(1 - k) * 100}%)`;
    if (p.clip.transitionIn === "whip") {
      transform = `translateX(${(1 - k) * 100}%)`;
      filter = `blur(${((1 - k) * 7).toFixed(1)}px)`;
    }
    if (p.clip.transitionIn === "spin") {
      transform = `rotate(${(-(1 - k) * 28).toFixed(1)}deg) scale(${1 + 0.6 * (1 - k)})`;
      filter = `blur(${((1 - k) * 6).toFixed(1)}px)`;
    }
    if (p.clip.transitionIn === "glitch") {
      const j = 1 - k;
      opacity = k < 0.12 ? 0 : 1;
      transform = `translateX(${(Math.sin(k * 60) * j * 14).toFixed(1)}px)`;
      filter = `blur(${(j * 2.5).toFixed(1)}px) saturate(${(1 + j * 2.2).toFixed(2)}) hue-rotate(${(j * 90).toFixed(0)}deg)`;
    }
    if (p.clip.transitionIn === "flash") {
      // Hit white, then settle into the clip. The overlay is drawn by the editor.
      opacity = 1;
    }
    if (p.clip.transitionIn === "zoom") {
      transform = `scale(${1.35 - 0.35 * k})`;
      opacity = Math.min(1, k * 2);
    }
  }
  return { visible, localMs, style: { opacity, transform, filter, zIndex: i + 1 } };
}

/**
 * Rough word timings for a voiceover we have no timestamps for: spread the
 * script's words across the audio length, weighting longer words and pauses
 * after punctuation. Good enough to caption an existing voiceover for free;
 * regenerating the voiceover gives exact timings.
 */
export function wordsFromScript(script: string, audioMs: number): CaptionWord[] {
  const tokens = script.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean);
  if (!tokens.length || audioMs <= 0) return [];
  const weight = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 2 + (/[.!?]$/.test(w) ? 5 : /[,;:\u2014-]$/.test(w) ? 2.5 : 0);
  const lead = Math.min(150, audioMs * 0.02);
  const span = Math.max(1, audioMs - lead - Math.min(250, audioMs * 0.03));
  const total = tokens.reduce((a, w) => a + weight(w), 0);
  let t = lead;
  return tokens.map((text) => {
    const len = (weight(text) / total) * span;
    const w = { text, startMs: Math.round(t), endMs: Math.round(t + len * 0.94) };
    t += len;
    return w;
  });
}
