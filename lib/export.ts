import type { Caption, CaptionStyle, Effect, Look, Project } from "./types";
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
  const tiktok = style === "tiktok";
  const neon = style === "neon";
  const size = tiktok ? 96 : box ? 70 : 84;
  // Colours are &HAABBGGRR. White text, black outline; box style uses a dark box.
  const styleLine = tiktok
    ? `Style: Cap,Poppins,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,10,0,2,70,70,520,1`
    : box
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
    // Neon: a soft yellow glow layer under crisp pale-yellow text.
    `Style: Glow,Poppins,76,&H0028F0F0,&H0028F0F0,&H0028F0F0,&H00000000,-1,0,0,0,100,100,2,0,1,10,0,2,70,70,430,1`,
    `Style: Neon,Poppins,76,&H00D8FFF4,&H00D8FFF4,&H0028F0F0,&H00000000,-1,0,0,0,100,100,2,0,1,2,0,2,70,70,430,1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  const ev = (a: number, b: number, text: string) =>
    lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Cap,,0,0,0,,${text}`);

  for (const c of captions) {
    if (neon) {
      // Whole phrase at once (1 to 3 words), uppercase, quick fade, with a glow underneath.
      const t = clean(c.text).toUpperCase();
      lines.push(`Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Glow,,0,0,0,,{\\blur14\\alpha&H70&\\fad(90,70)}${t}`);
      lines.push(`Dialogue: 1,${assTime(c.startMs)},${assTime(c.endMs)},Neon,,0,0,0,,{\\blur1.2\\fad(90,70)}${t}`);
      continue;
    }
    if (tiktok && c.words.length) {
      // One word lit at a time, popping in, like TikTok's own auto-captions.
      const words = c.words;
      const up = (t: string) => clean(t).toUpperCase();
      if (words[0].startMs > c.startMs) ev(c.startMs, words[0].startMs, words.map((x) => up(x.text)).join(" "));
      words.forEach((w, j) => {
        const end = j < words.length - 1 ? words[j + 1].startMs : c.endMs;
        if (end <= w.startMs) return;
        const text = words
          .map((x, i) =>
            i === j
              ? `{\\c&H4DE1FF&\\fscx86\\fscy86\\t(0,90,\\fscx112\\fscy112)}${up(x.text)}{\\c&HFFFFFF&\\fscx100\\fscy100}`
              : up(x.text),
          )
          .join(" ");
        ev(w.startMs, end, text);
      });
    } else if (style === "karaoke" && c.words.length) {
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
 * Effects applied to the finished frame while a transition plays (blur,
 * glitch). Blur strength steps down over thirds of the transition, which at
 * 30 fps reads as a smooth settle. Returns "" for transitions with no extra pass.
 */
export function transitionPost(kind: string, S: number, T: number): string {
  const f3 = (n: number) => n.toFixed(3);
  const win = (a: number, b: number) => `enable='between(t,${f3(a)},${f3(b)})'`;
  const third = T / 3;
  if (kind === "whip" || kind === "whipL" || kind === "whipU" || kind === "whipD") {
    const ang = kind === "whipU" || kind === "whipD" ? 90 : 0;
    return [90, 45, 14].map((r, n) => `dblur=angle=${ang}:radius=${r}:${win(S + n * third, S + (n + 1) * third)}`).join(",");
  }
  if (kind === "burn") {
    // Warm film-burn dissolve: the frame blooms orange, softens, then settles.
    const steps: [number, number, number][] = [[S - 0.12, S, 0.55], [S, S + third, 1], [S + third, S + 2 * third, 0.55], [S + 2 * third, S + T, 0.2]];
    return steps.map(([a, b, k]) =>
      `lutyuv=y='clip(val*${(1 + 0.18 * k).toFixed(3)}+${Math.round(14 * k)},0,255)':u='val-${Math.round(14 * k)}':v='val+${Math.round(18 * k)}':${win(a, b)},gblur=sigma=${(7 * k).toFixed(2)}:${win(a, b)}`,
    ).join(",");
  }
  if (kind === "spin") {
    return [16, 8, 3].map((sg, n) => `gblur=sigma=${sg}:${win(S + n * third, S + (n + 1) * third)}`).join(",");
  }
  if (kind === "glitch") {
    // Smear the outgoing shot into vertical streaks, dip to near-black, then resolve into the next one.
    const parts: string[] = [];
    parts.push(`pixelize=w=56:h=520:${win(S - 0.14, S - 0.04)}`);
    parts.push(`chromashift=crh=-26:cbh=26:${win(S - 0.14, S - 0.04)}`);
    parts.push(`eq=brightness=-0.85:${win(S - 0.04, S + 0.04)}`);
    [[44, 420], [26, 200], [12, 60]].forEach(([w, h], n) => {
      parts.push(`pixelize=w=${w}:h=${h}:${win(S + 0.04 + n * third, S + 0.04 + (n + 1) * third)}`);
    });
    [-20, -11, -4].forEach((c, n) => {
      parts.push(`chromashift=crh=${c}:cbh=${-c}:${win(S + 0.04 + n * third, S + 0.04 + (n + 1) * third)}`);
    });
    return parts.join(",");
  }
  return "";
}

/**
 * Whole-video finish (grain, scanlines, vignette, colour fringing) as one
 * ffmpeg filter chain, or "" when everything is off. Applied before captions
 * so the text stays crisp.
 */
export function buildLookChain(look: Look | undefined): string {
  if (!look) return "";
  const f: string[] = [];
  if (look.rgb > 0) {
    const px = Math.max(1, Math.round((look.rgb / 100) * 7));
    f.push(`rgbashift=rh=-${px}:bh=${px}:edge=smear`);
  }
  if (look.vignette > 0) {
    // Smaller angle = harder vignette.
    const angle = (0.9 - (look.vignette / 100) * 0.55).toFixed(3);
    f.push(`vignette=angle=${angle}:mode=backward:eval=init`);
  }
  if (look.scanlines > 0) {
    const a = ((look.scanlines / 100) * 0.35).toFixed(3);
    f.push(`drawgrid=w=0:h=4:t=1:c=black@${a}`);
  }
  if (look.grain > 0) {
    const g = Math.max(2, Math.round((look.grain / 100) * 22));
    f.push(`noise=alls=${g}:allf=t`);
  }
  if (!f.length) return "";
  return f.join(",") + ",format=yuv420p";
}

/**
 * Timeline effects (push, pull, shake, flash, glitch, blur, rgb) as one filter
 * chain, or "" when there are none. Camera moves share one scale+crop stage;
 * the rest are timeline-windowed filters. Mirrors effectState() in timeline.ts.
 */
export function buildEffectsChain(effects: Effect[] | undefined, W: number, H: number): string {
  if (!effects || !effects.length) return "";
  const f3 = (n: number) => n.toFixed(3);
  const out: string[] = [];
  const terms: string[] = [];
  const sx: string[] = [];
  const sy: string[] = [];
  for (const e of effects) {
    const a = e.startMs / 1000;
    const d = e.durationMs / 1000;
    const b = a + d;
    const k = e.strength / 100;
    const win = `between(t,${f3(a)},${f3(b)})`;
    const prog = `clip((t-${f3(a)})/${f3(d)},0,1)`;
    if (e.type === "push") terms.push(`${win}*${f3(0.05 + 0.3 * k)}*${prog}`);
    if (e.type === "pull") terms.push(`${win}*${f3(0.05 + 0.3 * k)}*(1-${prog})`);
    if (e.type === "shake") {
      terms.push(`${win}*0.1`);
      const amp = 6 + 36 * k;
      sx.push(`${win}*${f3(amp)}*sin(t*61)`);
      sy.push(`${win}*${f3(amp * 0.8)}*cos(t*53)`);
    }
  }
  if (terms.length || sx.length) {
    const Z = `(1+${terms.length ? terms.join("+") : "0"})`;
    out.push(`scale=w='trunc(${W}*${Z}/2)*2':h='trunc(${H}*${Z}/2)*2':eval=frame`);
    out.push(`crop=${W}:${H}:x='(iw-${W})/2+${sx.length ? sx.join("+") : "0"}':y='(ih-${H})/2+${sy.length ? sy.join("+") : "0"}'`);
    out.push("setsar=1");
  }
  for (const e of effects) {
    const a = e.startMs / 1000;
    const d = e.durationMs / 1000;
    const k = e.strength / 100;
    const third = d / 3;
    const win = (x: number, y: number) => `enable='between(t,${f3(x)},${f3(y)})'`;
    if (e.type === "flash") {
      [0.9, 0.55, 0.22].forEach((al, n) => {
        out.push(`drawbox=x=0:y=0:w=iw:h=ih:color=white@${f3(Math.min(1, al * (0.4 + 0.6 * k)))}:t=fill:${win(a + n * third, a + (n + 1) * third)}`);
      });
    }
    if (e.type === "blur") {
      const sg = 4 + 24 * k;
      [0.5, 1, 0.5].forEach((m, n) => out.push(`gblur=sigma=${f3(sg * m)}:${win(a + n * third, a + (n + 1) * third)}`));
    }
    if (e.type === "rgb") {
      const c = Math.round(4 + 26 * k);
      out.push(`chromashift=crh=-${c}:cbh=${c}:${win(a, a + d)}`);
    }
    if (e.type === "glitch") {
      [[44, 420], [26, 200], [12, 60]].forEach(([w, h], n) => {
        const c = Math.round((20 - n * 7) * (0.4 + 0.6 * k));
        out.push(`pixelize=w=${w}:h=${h}:${win(a + n * third, a + (n + 1) * third)}`);
        out.push(`chromashift=crh=-${c}:cbh=${c}:${win(a + n * third, a + (n + 1) * third)}`);
      });
    }
  }
  return out.join(",");
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
    } else if (kind === "slideL") {
      x = `-W*pow(1-${prog},3)`;
    } else if (kind === "slideU") {
      y = `H*pow(1-${prog},3)`;
    } else if (kind === "slideD") {
      y = `-H*pow(1-${prog},3)`;
    } else if (kind === "whip") {
      x = `W*pow(1-${prog},3)`;
    } else if (kind === "whipL") {
      x = `-W*pow(1-${prog},3)`;
    } else if (kind === "whipU") {
      y = `H*pow(1-${prog},3)`;
    } else if (kind === "whipD") {
      y = `-H*pow(1-${prog},3)`;
    } else if (kind === "burn") {
      chain += `,format=yuva420p,fade=t=in:st=${S.toFixed(3)}:d=${T.toFixed(3)}:alpha=1`;
    } else if (kind === "spin") {
      // Zoomed-in and rotated, settling flat. Rotate on a fixed-size frame (crop after the zoom).
      const k = `clip((t-${S.toFixed(3)})/${T.toFixed(3)},0,1)`;
      chain += `,scale=w='${W}*(1.7-0.7*(1-pow(1-${k},3)))':h=-2:eval=frame,crop=${W}:${H},format=yuva420p,rotate=a='-0.55*pow(1-${k},3)':ow=${W}:oh=${H}:c=none`;
    } else if (kind === "glitch") {
      // The glitch itself is applied to the finished frame below.
    } else if (kind === "flash") {
      // Cut to white, then settle into the clip.
      chain += `,format=yuv420p,fade=t=in:st=${S.toFixed(3)}:d=${T.toFixed(3)}:color=white`;
    } else if (kind === "zoom") {
      chain += `,scale=w='${W}*(1+0.35*pow(1-${prog},3))':h=-2:eval=frame,format=yuva420p,fade=t=in:st=${S.toFixed(3)}:d=${(T / 2).toFixed(3)}:alpha=1`;
      x = "(W-w)/2";
      y = "(H-h)/2";
    }
    parts.push(`${chain}[v${i}]`);
    const E = S + L;
    const post = transitionPost(kind, S, T);
    parts.push(
      `[b${i}][v${i}]overlay=x='${x}':y='${y}':format=auto:eof_action=pass:enable='between(t,${S.toFixed(3)},${E.toFixed(3)})'${post ? `[o${i}];[o${i}]${post}` : ""}[b${i + 1}]`,
    );
  });

  let last = `b${placed.length}`;
  const fxChain = buildEffectsChain(project.effects, W, H);
  if (fxChain) {
    parts.push(`[${last}]${fxChain}[fx]`);
    last = "fx";
  }
  const lookChain = buildLookChain(project.look);
  if (lookChain) {
    parts.push(`[${last}]${lookChain}[lk]`);
    last = "lk";
  }
  if (hasCaptions) {
    parts.push(`[${last}]ass=captions.ass:fontsdir=fonts[vout]`);
  } else {
    parts.push(`[${last}]null[vout]`);
  }
  const t = total.toFixed(3);
  const fadeS = Math.min(total, Math.max(0, (project.musicFadeMs ?? 1500) / 1000));
  const fadeAt = Math.max(0, total - fadeS).toFixed(3);
  const fade = fadeS > 0 ? `,afade=t=out:st=${fadeAt}:d=${fadeS.toFixed(3)}` : "";
  const vol = (Math.min(100, Math.max(0, project.musicVolume ?? 25)) / 100).toFixed(2);
  if (audioInput >= 0 && musicInput >= 0) {
    parts.push(`[${audioInput}:a]aresample=44100,atrim=duration=${t},apad=whole_dur=${t}[vo]`);
    parts.push(`[${musicInput}:a]aresample=44100,atrim=duration=${t},volume=${vol}${fade}[mu]`);
    parts.push(`[vo][mu]amix=inputs=2:duration=first:normalize=0[aout]`);
  } else if (audioInput >= 0) {
    parts.push(`[${audioInput}:a]aresample=44100,atrim=duration=${t},apad=whole_dur=${t}[aout]`);
  } else if (musicInput >= 0) {
    parts.push(`[${musicInput}:a]aresample=44100,atrim=duration=${t},volume=${vol}${fade},apad=whole_dur=${t}[aout]`);
  } else {
    parts.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${t}[aout]`);
  }
  return { graph: parts.join(";\n"), totalMs };
}
