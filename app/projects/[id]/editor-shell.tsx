"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Project, Clip, ChatMessage } from "@/lib/types";

type PexelsVideo = {
  id: number;
  url: string;
  width: number;
  height: number;
  durationMs: number;
  thumbnail: string;
  author: string;
};

function fmtMs(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function EditorShell({ project: initial }: { project: Project }) {
  const [project, setProject] = useState<Project>(initial);
  const [title, setTitle] = useState(initial.title);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const router = useRouter();

  const [tab, setTab] = useState<"footage" | "claude">("footage");

  const [query, setQuery] = useState("");
  const [videos, setVideos] = useState<PexelsVideo[]>([]);
  const [searching, setSearching] = useState(false);
  const [hoverVideo, setHoverVideo] = useState<PexelsVideo | null>(null);
  const hoverVideoRef = useRef<HTMLVideoElement>(null);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const dragClipId = useRef<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [voiceoverScript, setVoiceoverScript] = useState(initial.voiceoverScript ?? "");
  const [audioUrl, setAudioUrl] = useState(initial.voiceoverUrl ?? "");
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setSaveState("saving");
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json() as Project;
        setProject((p) => ({ ...p, ...updated }));
      }
      setSaveState("saved");
      return res;
    },
    [project.id],
  );

  async function saveTitle() {
    if (title === project.title) return;
    await patch({ title });
  }

  async function deleteProject() {
    if (!confirm("Delete this project? This cannot be undone.")) return;
    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    router.push("/");
  }

  useEffect(() => {
    async function onKey(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedClipId) {
        if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
        e.preventDefault();
        setSaveState("saving");
        const res = await fetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "removeClip", clipId: selectedClipId }),
        });
        if (res.ok) {
          const updated = await res.json() as Project;
          setProject(updated);
          setSelectedClipId(null);
        }
        setSaveState("saved");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedClipId, project.id]);

  async function searchPexels(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/pexels?q=${encodeURIComponent(query)}&per_page=20`);
      if (res.ok) setVideos(await res.json());
    } finally {
      setSearching(false);
    }
  }

  async function addClipToTimeline(v: PexelsVideo) {
    setSaveState("saving");
    const clip: Omit<Clip, "id" | "projectId" | "order"> = {
      durationMs: v.durationMs,
      trimStartMs: 0,
      pexelsVideoId: v.id,
      pexelsUrl: v.url,
      pexelsThumbnail: v.thumbnail,
      pexelsAuthor: v.author,
      pexelsWidth: v.width,
      pexelsHeight: v.height,
    };
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addClip", clip }),
    });
    if (res.ok) {
      const projRes = await fetch(`/api/projects/${project.id}`);
      if (projRes.ok) setProject(await projRes.json());
    }
    setSaveState("saved");
  }

  function onDragStart(clipId: string) {
    dragClipId.current = clipId;
  }

  function onDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragClipId.current || dragClipId.current === targetId) return;
    const clips = [...project.clips];
    const fromIdx = clips.findIndex((c) => c.id === dragClipId.current);
    const toIdx = clips.findIndex((c) => c.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = clips.splice(fromIdx, 1);
    clips.splice(toIdx, 0, moved);
    setProject((p) => ({ ...p, clips }));
  }

  async function onDrop() {
    dragClipId.current = null;
    setSaveState("saving");
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorderClips", orderedIds: project.clips.map((c) => c.id) }),
    });
    setSaveState("saved");
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || streaming) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput };
    const history = [...messages, userMsg];
    setMessages(history);
    setChatInput("");
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages([...history, assistantMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          projectTitle: project.title,
          clipsCount: project.clips.length,
        }),
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const json = JSON.parse(data);
            const delta = json.delta?.text ?? "";
            full += delta;
            setMessages([...history, { role: "assistant", content: full }]);
          } catch {
            // skip non-JSON lines
          }
        }
      }

      const match = full.match(/<voiceover>([\s\S]*?)<\/voiceover>/);
      if (match) {
        const script = match[1].trim();
        setVoiceoverScript(script);
        await patch({ voiceoverScript: script });
      }
    } finally {
      setStreaming(false);
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function generateVoiceover() {
    if (!voiceoverScript.trim()) return;
    setGeneratingAudio(true);
    try {
      const res = await fetch("/api/elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: voiceoverScript }),
      });
      if (res.ok) {
        const { audioUrl: url } = await res.json() as { audioUrl: string };
        setAudioUrl(url);
        await patch({ voiceoverUrl: url });
      }
    } finally {
      setGeneratingAudio(false);
    }
  }

  useEffect(() => {
    if (hoverVideo && hoverVideoRef.current) {
      hoverVideoRef.current.load();
      hoverVideoRef.current.play().catch(() => {});
    }
  }, [hoverVideo]);

  const totalMs = project.clips.reduce((sum, c) => sum + c.durationMs, 0);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>

      <div style={{ width: 340, minWidth: 280, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", background: "var(--panel)" }}>

        <div className="row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", gap: 8 }}>
          <a href="/" style={{ color: "var(--muted)", fontSize: 18, lineHeight: 1 }}>←</a>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            style={{ flex: 1, fontWeight: 600, background: "transparent", border: "none", borderBottom: "1px solid transparent", borderRadius: 0, padding: "2px 4px", fontSize: 14 }}
            onFocus={(e) => (e.currentTarget.style.borderBottomColor = "var(--accent)")}
            onBlurCapture={(e) => (e.currentTarget.style.borderBottomColor = "transparent")}
          />
          <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
            {saveState === "saving" ? "Saving…" : "Saved"}
          </span>
          <button onClick={deleteProject} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }} title="Delete project">🗑</button>
        </div>

        <div className="row" style={{ borderBottom: "1px solid var(--border)" }}>
          {(["footage", "claude"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "8px 0", background: "none", border: "none", borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent", color: tab === t ? "var(--fg)" : "var(--muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === t ? 600 : 400 }}>
              {t === "footage" ? "🎬 Footage" : "🤖 Claude"}
            </button>
          ))}
        </div>

        {tab === "footage" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {hoverVideo && (
              <div style={{ padding: 8, borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                <video ref={hoverVideoRef} src={hoverVideo.url} muted loop playsInline style={{ width: "100%", borderRadius: 6, maxHeight: 200, objectFit: "cover" }} />
                <p style={{ fontSize: 11, marginTop: 4 }} className="muted">{fmtMs(hoverVideo.durationMs)} · by {hoverVideo.author}</p>
              </div>
            )}
            <form onSubmit={searchPexels} style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6 }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Pexels footage…" style={{ flex: 1, fontSize: 13 }} />
              <button className="primary" type="submit" style={{ padding: "6px 12px", fontSize: 13 }} disabled={searching}>{searching ? "…" : "Go"}</button>
            </form>
            <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, alignContent: "start" }}>
              {videos.map((v) => (
                <div key={v.id} style={{ position: "relative", borderRadius: 6, overflow: "hidden", cursor: "pointer", border: "1px solid var(--border)" }} onMouseEnter={() => setHoverVideo(v)} onMouseLeave={() => setHoverVideo(null)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.thumbnail} alt="" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", display: "block" }} />
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.7))", padding: "12px 6px 6px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <span style={{ fontSize: 10, color: "#fff" }}>{fmtMs(v.durationMs)}</span>
                    <button onClick={() => addClipToTimeline(v)} style={{ background: "var(--accent)", border: "none", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 12, cursor: "pointer" }}>+</button>
                  </div>
                </div>
              ))}
              {!videos.length && !searching && (
                <p className="muted" style={{ gridColumn: "1/-1", textAlign: "center", fontSize: 12, padding: 16 }}>Search for portrait footage above.</p>
              )}
            </div>
          </div>
        )}

        {tab === "claude" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.length === 0 && (
                <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 20 }}>Ask Claude to help plan your video, write a script, or suggest footage searches.</p>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? "var(--accent)" : "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", maxWidth: "90%", fontSize: 13, color: m.role === "user" ? "#fff" : "var(--fg)", whiteSpace: "pre-wrap" }}>
                  {m.content}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>Voiceover script</p>
              <textarea value={voiceoverScript} onChange={(e) => setVoiceoverScript(e.target.value)} onBlur={() => patch({ voiceoverScript })} placeholder="Claude will fill this from <voiceover> tags, or type your own…" rows={4} style={{ fontSize: 12, resize: "vertical" }} />
              <button className="primary" onClick={generateVoiceover} disabled={!voiceoverScript.trim() || generatingAudio} style={{ fontSize: 12, padding: "6px 0" }}>
                {generatingAudio ? "Generating…" : "🎙 Generate voiceover"}
              </button>
              {audioUrl && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio controls src={audioUrl} style={{ width: "100%", height: 32 }} />
              )}
            </div>
            <form onSubmit={sendMessage} style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 6 }}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Message Claude…" disabled={streaming} style={{ flex: 1, fontSize: 13 }} />
              <button className="primary" type="submit" disabled={streaming || !chatInput.trim()} style={{ padding: "6px 12px", fontSize: 13 }}>{streaming ? "…" : "↑"}</button>
            </form>
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, gap: 24, overflow: "hidden" }}>
          <div style={{ width: 270, height: 480, background: "#111", borderRadius: 24, border: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
            {project.clips[0] ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video key={project.clips[0].id} src={project.clips[0].pexelsUrl} muted autoPlay loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>No clips yet</span>
            )}
          </div>
          <div className="card" style={{ width: 200, alignSelf: "flex-start" }}>
            <p style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>Inspector</p>
            {selectedClipId ? (
              (() => {
                const clip = project.clips.find((c) => c.id === selectedClipId);
                return clip ? (
                  <>
                    <p style={{ fontSize: 12, marginBottom: 4 }}>Duration</p>
                    <p className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{fmtMs(clip.durationMs)}</p>
                    <p style={{ fontSize: 12, marginBottom: 4 }}>Source</p>
                    <p className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Pexels · {clip.pexelsAuthor}</p>
                    <p style={{ fontSize: 12, marginBottom: 4 }}>Size</p>
                    <p className="muted" style={{ fontSize: 11 }}>{clip.pexelsWidth} × {clip.pexelsHeight}</p>
                    <hr style={{ borderColor: "var(--border)", margin: "10px 0" }} />
                    <p className="muted" style={{ fontSize: 11 }}>Press Delete to remove</p>
                  </>
                ) : null;
              })()
            ) : (
              <>
                <p className="muted" style={{ fontSize: 12 }}>Select a clip to inspect it.</p>
                <hr style={{ borderColor: "var(--border)", margin: "10px 0" }} />
                <p style={{ fontSize: 12 }}>Project</p>
                <p className="muted" style={{ fontSize: 11 }}>1080 × 1920 · 30 fps</p>
                <p className="muted" style={{ fontSize: 11 }}>{fmtMs(totalMs)} total</p>
              </>
            )}
          </div>
        </div>

        <div style={{ minHeight: 180, maxHeight: 240, borderTop: "1px solid var(--border)", background: "var(--panel)", padding: 12, display: "flex", flexDirection: "column" }}>
          <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Timeline · {project.clips.length} clip{project.clips.length !== 1 ? "s" : ""} · {fmtMs(totalMs)}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
              <span className="muted" style={{ width: 68, fontSize: 11, textAlign: "right", paddingTop: 6, flexShrink: 0 }}>Video</span>
              <div style={{ flex: 1, minHeight: 48, background: "var(--bg)", borderRadius: 4, border: "1px dashed var(--border)", display: "flex", gap: 4, padding: 4, overflowX: "auto", alignItems: "center" }}>
                {project.clips.length === 0 && <span className="muted" style={{ fontSize: 11, padding: "0 8px" }}>Add clips from the Footage tab</span>}
                {project.clips.map((clip) => (
                  <div key={clip.id} draggable onDragStart={() => onDragStart(clip.id)} onDragOver={(e) => onDragOver(e, clip.id)} onDrop={onDrop} onClick={() => setSelectedClipId(clip.id === selectedClipId ? null : clip.id)} style={{ width: Math.max(48, (clip.durationMs / 1000) * 8), height: 40, borderRadius: 4, overflow: "hidden", flexShrink: 0, cursor: "grab", border: clip.id === selectedClipId ? "2px solid var(--accent)" : "2px solid transparent", position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={clip.pexelsThumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <span style={{ position: "absolute", bottom: 1, left: 2, fontSize: 9, color: "#fff", textShadow: "0 0 3px rgba(0,0,0,0.8)" }}>{fmtMs(clip.durationMs)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="muted" style={{ width: 68, fontSize: 11, textAlign: "right", paddingTop: 6, flexShrink: 0 }}>Voiceover</span>
              <div style={{ flex: 1, height: 28, background: "var(--bg)", borderRadius: 4, border: "1px dashed var(--border)", display: "flex", alignItems: "center", padding: "0 8px" }}>
                {audioUrl ? <span style={{ fontSize: 11, color: "var(--accent)" }}>🎙 Voiceover ready</span> : <span className="muted" style={{ fontSize: 11 }}>No voiceover yet</span>}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="muted" style={{ width: 68, fontSize: 11, textAlign: "right", paddingTop: 6, flexShrink: 0 }}>Captions</span>
              <div style={{ flex: 1, height: 28, background: "var(--bg)", borderRadius: 4, border: "1px dashed var(--border)", display: "flex", alignItems: "center", padding: "0 8px" }}>
                <span className="muted" style={{ fontSize: 11 }}>Coming soon</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
