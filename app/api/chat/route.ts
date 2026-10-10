import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { messages, projectContext } = await req.json();

  const systemPrompt = `You are a TikTok video producer helping create short-form vertical videos.
The user is editing a project with the following context:
${JSON.stringify(projectContext, null, 2)}

Help them with:
- Writing hooks and scripts for voiceovers
- Suggesting what stock footage to search for
- Recommending video structure and pacing
- Writing captions and on-screen text

Keep responses concise and practical. When you suggest a voiceover script, wrap it in <voiceover> tags so it can be extracted.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "messages-2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-20240307",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(JSON.stringify({ error: err }), { status: res.status });
  }

  // Stream the response back
  return new Response(res.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
