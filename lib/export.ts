import type { Caption, CaptionStyle, Project } from "./types";
import { layoutClips, clipsTotalMs } from "./timeline";

export const W = 1080;
export const H = 1920;
const FPS = 30;

const sec = (ms: number) => (ms / 1000).toFixed(3);

function assTime(ms: number) {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

const clean = (t: string) => t.replace(/[{}\\]/g, "").replace(/\n/g, " ");

/** Build an ASS subtitle file that matches the three caption styles in the preview. */
export function buildAss(captions: Caption[], style: CaptionStyle) {
  const box = style === "box";
  const size = box ? 70 : 84;
  // Colours are &HAABBGGRR. White text, black outline; box style uses a dark box.
  const styleLine = box
    ? `Style: Cap,Poppins,${size},&H00FFFFFF,&H00FFFFFF,&HC7000000,&HC7000000,-1,0,0,0,100,100,0,0,3,16,0,2,90,90,400,1`
    : `Style: Cap,Poppins,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,2,90,90,400,1`;
  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    styleLine,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  const ev = (a: number, b: number, text: string) =>
    lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Cap,,0,0,0,,${text}`);

  for (const c of captions) {
    if (style === "karaoke" && c.words.length) {
      const YELLOW = "{\\c&H4DE1FF&}";
      const WHITE = "{\\c&HFFFFFF&}";
      const words = c.words;
      if (words[0].startMs > c.startMs) ev(c.startMs, words[0].startMs, clean(c.text));
      words.forEach((w, j) => {
        const end = j < words.length - 1 ? words[j + 1].startMs : c.endMs;
        if (end <= w.startMs) return;
        const text = words
          .map((x, i) => `${i <= j ? YELLOW : WHITE}${clean(x.text)}`)
          .join(" ");
        ev(w.startMs, end, text);
      });
    } else {
      ev(c.startMs, c.endMs, clean(c.text));
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Build the ffmpeg filter graph. Mirrors layerAt() in timeline.ts:
 * each clip's transition-in plays over its first transitionMs on top of the
 * previous clip, which keeps rolling underneath until the transition ends.
 * `audioInput` is the input index of the voiceover (or -1 for none).
 */
export function buildFilterGraph(project: Project, hasCaptions: boolean, audioInput: number, musicInput = -1) {
  const placed = layoutClips(project.clips);
  const totalMs = clipsTotalMs(project.clips);
  const total = totalMs / 1000;
  const parts: string[] = [];

  parts.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${sec(totalMs)},format=yuv420p[b0]`);

  placed.forEach((p, i) => {
    const c = p.clip;
    const next = placed[i + 1];
    const nextT = next && next.clip.transitionIn !== "cut" ? next.clip.transitionMs : 0;
    const S = p.startMs / 1000;
    const L = (c.durationMs + nextT) / 1000;
    const kind = i > 0 ? c.transitionIn : "cut";
    const T = Math.max(0.05, c.transitionMs / 1000);
    const start = c.trimStartMs / 1000;

    let chain = `[${i}:v]trim=start=${start.toFixed(3)}:duration=${L.toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,tpad=stop_mode=clone:stop_duration=${L.toFixed(3)},trim=duration=${L.toFixed(3)},setpts=PTS-STARTPTS+${S.toFixed(3)}/TB`;

    const prog = `clip((t-${S.toFixed(3)})/${T.toFixed(3)},0,1)`;
    let x = "0";
    let y = "0";
    if (kind === "crossfade") {
      chain += `,format=yuva420p,fade=t=in:st=${S.toFixed(3)}:d=${T.toFixed(3)}:alpha=1`;
    } else if (kind === "slide") {
      x = `W*pow(1-${prog},3)`;
    } else if (kind === "zoom") {
      chain += `,scale=w='${W}*(1+0.35*pow(1-${prog},3))':h=-2:eval=frame,format=yuva420p,fade=t=in:st=${S.toFixed(3)}:d=${(T / 2).toFixed(3)}:alpha=1`;
      x = "(W-w)/2";
      y = "(H-h)/2";
    }
    parts.push(`${chain}[v${i}]`);
    const E = S + L;
    parts.push(
      `[b${i}][v${i}]overlay=x='${x}':y='${y}':format=auto:eof_action=pass:enable='between(t,${S.toFixed(3)},${E.toFixed(3)})'[b${i + 1}]`,
    );
  });

  const last = `b${placed.length}`;
  if (hasCaptions) {
    parts.push(`[${last}]ass=captions.ass:fontsdir=fonts[vout]`);
  } else {
    parts.push(`[${last}]null[vout]`);
  }
  const t = total.toFixed(3);
  const fadeAt = Math.max(0, total - 1.5).toFixed(3);
  const vol = (Math.min(100, Math.max(0, project.musicVolume ?? 25)) / 100).toFixed(2);
  if (audioInput >= 0 && musicInput >= 0) {
    parts.push(`[${audioInput}:a]aresample=44100,atrim=duration=${t},apad=whole_dur=${t}[vo]`);
    parts.push(`[${musicInput}:a]aresample=44100,atrim=duration=${t},volume=${vol},afade=t=out:st=${fadeAt}:d=1.5[mu]`);
    parts.push(`[vo][mu]amix=inputs=2:duration=first:normalize=0[aout]`);
  } else if (audioInput >= 0) {
    parts.push(`[${audioInput}:a]aresample=44100,atrim=duration=${t},apad=whole_dur=${t}[aout]`);
  } else if (musicInput >= 0) {
    parts.push(`[${musicInput}:a]aresample=44100,atrim=duration=${t},volume=${vol},afade=t=out:st=${fadeAt}:d=1.5,apad=whole_dur=${t}[aout]`);
  } else {
    parts.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${t}[aout]`);
  }
  return { graph: parts.join(";\n"), totalMs };
}
