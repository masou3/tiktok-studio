import { NextResponse } from "next/server";

// Rachel voice: warm, clear, works well for TikTok narration
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";

type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

/** Turn ElevenLabs character timings into word timings. */
function toWords(a: Alignment | undefined) {
  const words: { text: string; startMs: number; endMs: number }[] = [];
  if (!a?.characters?.length) return words;
  let cur = "";
  let start = 0;
  let end = 0;
  a.characters.forEach((ch, i) => {
    const s = a.character_start_times_seconds[i] ?? 0;
    const e = a.character_end_times_seconds[i] ?? s;
    if (/\s/.test(ch)) {
      if (cur) words.push({ text: cur, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
      cur = "";
      return;
    }
    if (!cur) start = s;
    cur += ch;
    end = e;
  });
  if (cur) words.push({ text: cur, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
  return words;
}

export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("ElevenLabs error", res.status, detail);
    return NextResponse.json({ error: "ElevenLabs error", detail }, { status: res.status });
  }

  const data = (await res.json()) as {
    audio_base64: string;
    alignment?: Alignment;
    normalized_alignment?: Alignment;
  };
  const words = toWords(data.alignment ?? data.normalized_alignment);
  return NextResponse.json({
    audioUrl: `data:audio/mpeg;base64,${data.audio_base64}`,
    words,
  });
}
