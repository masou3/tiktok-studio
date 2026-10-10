import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    messages: { role: string; content: string }[];
    projectTitle?: string;
    clipsCount?: number;
  };

  const systemPrompt = `You are a creative video producer helping build a TikTok short-form video.
Current project: "${body.projectTitle ?? "Untitled"}" with ${body.clipsCount ?? 0} clips.

Help the user with:
- Suggesting video concepts and structure
- Writing engaging scripts and voiceover copy
- Choosing visual themes and clip ideas to search for
- Pacing advice (typical TikTok: hook in 0-3s, value in 3-25s, CTA at end)
- Caption and hashtag suggestions

When writing a voiceover script, wrap it in <voiceover> tags like:
<voiceover>
[The full script text here, spoken naturally, no stage directions]
</voiceover>

Keep responses concise -- this is a creative tool, not a lecture.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-20240307",
      max_tokens: 1024,
      system: systemPrompt,
      messages: body.messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Anthropic error" }, { status: res.status });
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
