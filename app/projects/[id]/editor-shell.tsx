"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Project, ChatMessage } from "@/lib/types";

type PexelsResult = {
  id: number; url: string; width: number; height: number;
  durationMs: number; thumbnail: string; author: string;
};

function msToTimecode(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const PX_PER_SEC = 40;
const TRACK_H = 52;

export default function EditorShell({ project: initial }: { project: Project }) {
  const [project, setProject] = useState<Project>({
    ...initial, clips: initial.clips ?? [],
    voiceoverScript: initial.voiceoverScript ?? "",
    voiceoverUrl: initial.voiceoverUrl ?? "",
  });
  const [title, setTitle] = useState(initial.title);
  const [saved, setSaved] = useState(true);
  const router = useRouter();

  // Panel tabs: "search" | "claude"
  const [panel, setPanel] = useState<"search" | "claude">("search");

  // Pexels
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PexelsResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [hoverVideo, setHoverVideo] = useState<{ id: number; url: string } | null>(null);
  const hoverRef = useRef<HTMLVideoElement>(null);

  // Claude chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ElevenLabs
  const [voiceoverScript, setVoiceoverScript] = useState(initial.voiceoverScript ?? "");
  const [generatingVoice, setGeneratingVoice] = useState(false);

  // Player
  const [playingClipIdx, setPlayingClipIdx] = useState<number | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragId = useRef<string | null>(null);

  // Delete key handler
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") &&
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLTextAreaElement)) {
        if (selectedClipId) removeClip(selectedClipId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedClipId]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Hover video preview
  useEffect(() => {
    if (hoverVideo && hoverRef.current) {
      hoverRef.current.src = hoverVideo.url;
      hoverRef.current.play().catch(() => {});
    }
  }, [hoverVideo]);

  async function patchProject(body: object): Promise<Project> {
    setSaved(false);
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const updated = await res.json();
    setSaved(true);
    return updated;
  }

  async function saveTitle() {
    if (title === project.title) return;
    const updated = await patchProject({ title });
    setProject(updated);
  }

  async function deleteProject() {
    if (!confirm("Delete this project?")) return;
    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    router.push("/");
  }

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setSearchDone(false);
    const res = await fetch(`/api/pexels?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResults(data.videos ?? []);
    setSearching(false); setSearchDone(true);
  }

  async function addClip(v: PexelsResult) {
    const updated = await patchProject({
      action: "addClip",
      clip: {
        durationMs: Math.min(v.durationMs, 15000),
        trimStartMs: 0,
        pexelsVideoId: v.id,
        pexelsUrl: v.url,
        pexelsThumbnail: v.thumbnail,
        pexelsAuthor: v.author,
        pexelsWidth: v.width,
        pexelsHeight: v.height,
      },
    });
    setProject(updated);
  }

  async function removeClip(clipId: string) {
    const updated = await patchProject({ action: "removeClip", clipId });
    setProject(updated);
    if (selectedClipId === clipId) setSelectedClipId(null);
    if (playingClipIdx !== null) setPlayingClipIdx(null);
  }

  const onDragStart = useCallback((id: string) => { dragId.current = id; }, []);
  const onDrop = useCallback(async (targetId: string) => {
    if (!dragId.current || dragId.current === targetId) return;
    const ids = project.clips.map((c) => c.id);
    const from = ids.indexOf(dragId.current), to = ids.indexOf(targetId);
    const reordered = [...ids];
    reordered.splice(from, 1);
    reordered.splice(to, 0, dragId.current);
    dragId.current = null;
    const updated = await patchProject({ action: "reorderClips", orderedIds: reordered });
    setProject(updated);
  }, [project.clips]);

  function playClip(idx: number) {
    setPlayingClipIdx(idx);
    setSelectedClipId(project.clips[idx]?.id ?? null);
    setTimeout(() => videoRef.current?.play(), 50);
  }

  // Claude chat
  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setChatInput("");
    setChatLoading(true);

    const projectContext = {
      title: project.title,
      clips: project.clips.length,
      totalDuration: msToTimecode(project.durationMs),
      voiceoverScript: voiceoverScript || "(none yet)",
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          projectContext,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      const assistantMsg: ChatMessage = { role: "assistant", content: "" };
      setMessages([...newMessages, assistantMsg]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.delta?.text ?? parsed.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              assistantText += delta;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: assistantText };
                return next;
              });
            }
          } catch {}
        }
      }

      // Extract voiceover script if Claude wrapped one in tags
      const match = assistantText.match(/<voiceover>([\s\S]*?)<\/voiceover>/);
      if (match) setVoiceoverScript(match[1].trim());

    } finally {
      setChatLoading(false);
    }
  }

  // ElevenLabs
  async function generateVoiceover() {
    if (!voiceoverScript.trim()) return;
    setGeneratingVoice(true);
    try {
      const res = await fetch("/api/elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: voiceoverScript }),
      });
      const data = await res.json();
      if (data.audioUrl) {
        const updated = await patchProject({
          voiceoverScript,
          voiceoverUrl: data.audioUrl,
        });
        setProject({ ...updated, voiceoverUrl: data.audioUrl });
      }
    } finally {
      setGeneratingVoice(false);
    }
  }

  const currentClip = playingClipIdx !== null ? project.clips[playingClipIdx] : null;
  const selectedClip = project.clips.find((c) => c.id === selectedClipId) ?? null;
  const totalMs = project.clips.reduce((s, c) => s + c.durationMs, 0);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>

      {/* ---- Left panel ---- */}
      <div style={{ width: 300, minWidth: 260, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", background: "var(--panel)" }}>

        {/* Header */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <a href="/" style={{ color: "var(--muted)", fontSize: 18, lineHeight: 1 }}>←</a>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              style={{ flex: 1, margin: "0 8px", fontWeight: 600, background: "transparent", border: "none", borderBottom: "1px solid transparent", borderRadius: 0, padding: "2px 4px" }}
              onFocus={(e) => (e.currentTarget.style.borderBottomColor = "var(--accent)")}
              onBlurCapture={(e) => (e.currentTarget.style.borderBottomColor = "transparent")}
            />
            <span style={{ fontSize: 10, color: saved ? "var(--muted)" : "var(--accent)", marginRight: 6 }}>
              {saved ? "Saved" : "Saving…"}
            </span>
            <button onClick={deleteProject} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }}>🗑</button>
          </div>

          {/* Tab switcher */}
          <div className="row" style={{ gap: 0, background: "var(--bg)", borderRadius: 6, padding: 2 }}>
            {(["search", "claude"] as const).map((tab) => (
              <button key={tab} onClick={() => setPanel(tab)} style={{
                flex: 1, padding: "5px 0", fontSize: 12, fontWeight: panel === tab ? 600 : 400,
                background: panel === tab ? "var(--panel)" : "transparent",
                border: "none", borderRadius: 5, cursor: "pointer",
                color: panel === tab ? "var(--fg)" : "var(--muted)",
              }}>
                {tab === "search" ? "🎬 Footage" : "🤖 Claude"}
              </button>
            ))}
          </div>
        </div>

        {/* Footage panel */}
        {panel === "search" && (
          <>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
              <form onSubmit={doSearch} style={{ display: "flex", gap: 6 }}>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Pexels…" style={{ flex: 1, fontSize: 12 }} />
                <button className="primary" type="submit" style={{ padding: "6px 10px", fontSize: 12 }} disabled={searching}>
                  {searching ? "…" : "Go"}
                </button>
              </form>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 8, position: "relative" }}>
              {!searchDone && !searching && <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 24 }}>Search for stock footage above,<br />then click a clip to add it.</p>}
              {searching && <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 24 }}>Searching…</p>}
              {searchDone && results.length === 0 && <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 24 }}>No results.</p>}

              {/* Hover video preview overlay */}
              {hoverVideo && (
                <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--panel)", paddingBottom: 8 }}>
                  <video ref={hoverRef} muted loop playsInline
                    style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", borderRadius: 6 }} />
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {results.map((v) => (
                  <div key={v.id} style={{ position: "relative" }}>
                    <button
                      onClick={() => addClip(v)}
                      onMouseEnter={() => setHoverVideo({ id: v.id, url: v.url })}
                      onMouseLeave={() => setHoverVideo(null)}
                      title={`${v.author} · ${msToTimecode(v.durationMs)} — click to add`}
                      style={{ width: "100%", background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: 0, cursor: "pointer", overflow: "hidden", position: "relative" }}
                    >
                      <img src={v.thumbnail} alt="" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", display: "block" }} />
                      <span style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, padding: "1px 4px", borderRadius: 3 }}>
                        {msToTimecode(v.durationMs)}
                      </span>
                      <span style={{ position: "absolute", top: 4, right: 4, background: "var(--accent)", color: "#fff", fontSize: 14, width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>+</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Claude panel */}
        {panel === "claude" && (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.length === 0 && (
                <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 24 }}>
                  Ask Claude to write a hook, suggest footage searches, or draft a voiceover script.<br /><br />
                  Try: <em>"Write a 30-second script about morning coffee routines"</em>
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "90%", padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                  background: m.role === "user" ? "var(--accent)" : "var(--bg)",
                  color: m.role === "user" ? "#fff" : "var(--fg)",
                  whiteSpace: "pre-wrap",
                }}>
                  {m.content.replace(/<voiceover>[\s\S]*?<\/voiceover>/g, "[voiceover script extracted ↓]")}
                </div>
              ))}
              {chatLoading && <div style={{ alignSelf: "flex-start", color: "var(--muted)", fontSize: 12 }}>Claude is typing…</div>}
              <div ref={chatEndRef} />
            </div>

            {/* Voiceover script box */}
            <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
              <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Voiceover script</p>
              <textarea
                value={voiceoverScript}
                onChange={(e) => setVoiceoverScript(e.target.value)}
                placeholder="Paste or edit your script here…"
                style={{ width: "100%", height: 80, fontSize: 11, resize: "vertical", fontFamily: "inherit" }}
              />
              <button
                className="primary"
                onClick={generateVoiceover}
                disabled={generatingVoice || !voiceoverScript.trim()}
                style={{ width: "100%", marginTop: 6, fontSize: 12 }}
              >
                {generatingVoice ? "Generating…" : "🎙 Generate voiceover"}
              </button>
              {project.voiceoverUrl && (
                <audio controls src={project.voiceoverUrl} style={{ width: "100%", marginTop: 6, height: 32 }} />
              )}
            </div>

            <form onSubmit={sendChat} style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 6 }}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Message Claude…"
                style={{ flex: 1, fontSize: 12 }}
                disabled={chatLoading}
              />
              <button className="primary" type="submit" disabled={chatLoading || !chatInput.trim()} style={{ padding: "6px 10px", fontSize: 12 }}>→</button>
            </form>
          </>
        )}
      </div>

      {/* ---- Right: preview + inspector + timeline ---- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

        {/* Preview + Inspector */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, gap: 20, overflow: "hidden" }}>
          <div style={{ width: 270, height: 480, borderRadius: 8, overflow: "hidden", background: "#000", flexShrink: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {currentClip ? (
              <video
                ref={videoRef}
                key={currentClip.id}
                src={currentClip.pexelsUrl}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                controls
                onEnded={() => {
                  const next = playingClipIdx !== null ? playingClipIdx + 1 : null;
                  if (next !== null && next < project.clips.length) playClip(next);
                  else setPlayingClipIdx(null);
                }}
              />
            ) : (
              <div style={{ textAlign: "center", color: "#555" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>▶</div>
                <p style={{ fontSize: 12 }}>{project.clips.length === 0 ? "Add clips to start" : "Click a clip to preview"}</p>
              </div>
            )}
          </div>

          <div className="card" style={{ width: 200, alignSelf: "flex-start", flexShrink: 0 }}>
            <p style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>Inspector</p>
            {selectedClip ? (
              <>
                <img src={selectedClip.pexelsThumbnail} alt="" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", borderRadius: 4, marginBottom: 8 }} />
                <p style={{ fontSize: 11, marginBottom: 2 }}>Duration</p>
                <p className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{msToTimecode(selectedClip.durationMs)}</p>
                <p style={{ fontSize: 11, marginBottom: 2 }}>Source</p>
                <p className="muted" style={{ fontSize: 11, marginBottom: 10, wordBreak: "break-all" }}>Pexels · {selectedClip.pexelsAuthor}</p>
                <button onClick={() => removeClip(selectedClip.id)} style={{ width: "100%", background: "none", border: "1px solid #e55", borderRadius: 4, padding: "5px 0", fontSize: 12, cursor: "pointer", color: "#e55" }}>
                  Remove clip
                </button>
                <p className="muted" style={{ fontSize: 10, textAlign: "center", marginTop: 4 }}>or press Delete</p>
              </>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Select a clip to edit its properties.</p>
                <hr style={{ borderColor: "var(--border)", margin: "8px 0" }} />
                <p style={{ fontSize: 12, marginBottom: 4 }}>Project</p>
                <p className="muted" style={{ fontSize: 11, marginBottom: 4 }}>1080 × 1920 · 30 fps · 9:16</p>
                <p className="muted" style={{ fontSize: 11 }}>{project.clips.length} clip{project.clips.length !== 1 ? "s" : ""} · {msToTimecode(totalMs)}</p>
              </>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--panel)", padding: "10px 14px", minHeight: 160 }}>
          <div className="row" style={{ marginBottom: 8, justifyContent: "space-between" }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Timeline · {msToTimecode(totalMs)}</span>
            <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={() => { setPlayingClipIdx(null); setTimeout(() => playClip(0), 50); }}
              disabled={project.clips.length === 0}>⏮ Play all</button>
          </div>

          {project.clips.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, textAlign: "center", padding: "16px 0" }}>Search for footage and click + to add clips here.</p>
          ) : (
            <div style={{ overflowX: "auto", paddingBottom: 8 }}>
              <div style={{ display: "flex", marginLeft: 68, marginBottom: 4, height: 14 }}>
                {Array.from({ length: Math.ceil(totalMs / 1000) + 1 }).map((_, i) => (
                  <div key={i} style={{ minWidth: PX_PER_SEC, fontSize: 9, color: "var(--muted)", borderLeft: "1px solid var(--border)", paddingLeft: 2 }}>
                    {i > 0 && msToTimecode(i * 1000)}
                  </div>
                ))}
              </div>

              <div className="row" style={{ gap: 0, alignItems: "stretch", marginBottom: 4 }}>
                <span className="muted" style={{ width: 68, fontSize: 11, textAlign: "right", paddingRight: 8, paddingTop: 6, flexShrink: 0 }}>Video</span>
                <div style={{ display: "flex", gap: 2, flex: 1 }}>
                  {project.clips.map((clip, idx) => {
                    const widthPx = Math.max(40, (clip.durationMs / 1000) * PX_PER_SEC);
                    const isSelected = clip.id === selectedClipId;
                    return (
                      <div key={clip.id}
                        draggable
                        onDragStart={() => onDragStart(clip.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => onDrop(clip.id)}
                        onClick={() => { setSelectedClipId(clip.id); playClip(idx); }}
                        style={{ width: widthPx, height: TRACK_H, borderRadius: 5, overflow: "hidden", cursor: "pointer", border: isSelected ? "2px solid var(--accent)" : "2px solid transparent", flexShrink: 0, position: "relative", background: "#111" }}
                      >
                        <img src={clip.pexelsThumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: isSelected ? 1 : 0.75 }} />
                        <span style={{ position: "absolute", bottom: 2, right: 3, background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 9, padding: "1px 3px", borderRadius: 2 }}>{msToTimecode(clip.durationMs)}</span>
                        <span style={{ position: "absolute", top: 2, left: 3, color: "#fff", fontSize: 9, background: "rgba(0,0,0,0.5)", padding: "0 2px", borderRadius: 2 }}>{idx + 1}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="row" style={{ gap: 0, marginTop: 4 }}>
                <span className="muted" style={{ width: 68, fontSize: 11, textAlign: "right", paddingRight: 8, flexShrink: 0 }}>Voiceover</span>
                <div style={{ flex: 1, height: 28, background: "var(--bg)", borderRadius: 4, border: project.voiceoverUrl ? "1px solid var(--accent)" : "1px dashed var(--border)", display: "flex", alignItems: "center", paddingLeft: 8 }}>
                  {project.voiceoverUrl
                    ? <span style={{ fontSize: 10, color: "var(--accent)" }}>🎙 Voiceover ready — play in Claude panel</span>
                    : <span className="muted" style={{ fontSize: 10 }}>Generate in Claude panel →</span>}
                </div>
              </div>

              <div className="row" style={{ gap: 0, marginTop: 4 }}>
                <span className="muted" style={{ width: 68, fontSize: 11, textAlign: "right", paddingRight: 8, flexShrink: 0 }}>Captions</span>
                <div style={{ flex: 1, height: 28, background: "var(--bg)", borderRadius: 4, border: "1px dashed var(--border)" }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
