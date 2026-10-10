"use client";
import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Project, Clip } from "@/lib/types";

// ---- Pexels result shape returned by our API route ----
type PexelsResult = {
  id: number;
  url: string;
  width: number;
  height: number;
  durationMs: number;
  thumbnail: string;
  author: string;
};

// ---- helpers ----
function msToTimecode(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const TRACK_H = 52;
const PX_PER_SEC = 40; // timeline pixels per second

export default function EditorShell({ project: initial }: { project: Project }) {
  const [project, setProject] = useState<Project>({ ...initial, clips: initial.clips ?? [] });
  const [title, setTitle] = useState(initial.title);
  const router = useRouter();

  // Pexels panel state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PexelsResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);

  // Player state
  const [playingClipIdx, setPlayingClipIdx] = useState<number | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Drag-to-reorder state
  const dragId = useRef<string | null>(null);

  // ---- API helpers ----
  async function patchProject(body: object): Promise<Project> {
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function saveTitle() {
    if (title === project.title) return;
    const updated = await patchProject({ title });
    setProject(updated);
  }

  async function deleteProject() {
    if (!confirm("Delete this project? This cannot be undone.")) return;
    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    router.push("/");
  }

  // ---- Pexels search ----
  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchDone(false);
    const res = await fetch(`/api/pexels?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResults(data.videos ?? []);
    setSearching(false);
    setSearchDone(true);
  }

  // ---- Add clip ----
  async function addClip(v: PexelsResult) {
    const updated = await patchProject({
      action: "addClip",
      clip: {
        durationMs: Math.min(v.durationMs, 15000), // cap at 15s
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

  // ---- Remove clip ----
  async function removeClip(clipId: string) {
    const updated = await patchProject({ action: "removeClip", clipId });
    setProject(updated);
    if (selectedClipId === clipId) setSelectedClipId(null);
    if (playingClipIdx !== null) setPlayingClipIdx(null);
  }

  // ---- Reorder clips ----
  const onDragStart = useCallback((id: string) => { dragId.current = id; }, []);
  const onDrop = useCallback(async (targetId: string) => {
    if (!dragId.current || dragId.current === targetId) return;
    const ids = project.clips.map((c) => c.id);
    const fromIdx = ids.indexOf(dragId.current);
    const toIdx = ids.indexOf(targetId);
    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, dragId.current);
    dragId.current = null;
    const updated = await patchProject({ action: "reorderClips", orderedIds: reordered });
    setProject(updated);
  }, [project.clips]);

  // ---- Play a clip in the preview ----
  function playClip(idx: number) {
    setPlayingClipIdx(idx);
    setSelectedClipId(project.clips[idx]?.id ?? null);
    // Let React re-render then play
    setTimeout(() => videoRef.current?.play(), 50);
  }

  const currentClip = playingClipIdx !== null ? project.clips[playingClipIdx] : null;
  const selectedClip = project.clips.find((c) => c.id === selectedClipId) ?? null;
  const totalMs = project.clips.reduce((s, c) => s + c.durationMs, 0);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>

      {/* ---- Left: Pexels search panel ---- */}
      <div style={{
        width: 300, minWidth: 260,
        borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column",
        background: "var(--panel)",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <a href="/" style={{ color: "var(--muted)", fontSize: 18, lineHeight: 1 }}>←</a>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              style={{
                flex: 1, margin: "0 10px", fontWeight: 600,
                background: "transparent", border: "none",
                borderBottom: "1px solid transparent", borderRadius: 0, padding: "2px 4px",
              }}
              onFocus={(e) => (e.currentTarget.style.borderBottomColor = "var(--accent)")}
              onBlurCapture={(e) => (e.currentTarget.style.borderBottomColor = "transparent")}
            />
            <button onClick={deleteProject} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }}>🗑</button>
          </div>

          <form onSubmit={doSearch} style={{ display: "flex", gap: 6 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Pexels videos…"
              style={{ flex: 1, fontSize: 12 }}
            />
            <button className="primary" type="submit" style={{ padding: "6px 10px", fontSize: 12 }} disabled={searching}>
              {searching ? "…" : "Go"}
            </button>
          </form>
        </div>

        {/* Results grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
          {!searchDone && !searching && (
            <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 24 }}>
              Search for stock footage above,<br />then click a clip to add it.
            </p>
          )}
          {searching && <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 24 }}>Searching…</p>}
          {searchDone && results.length === 0 && <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 24 }}>No results.</p>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {results.map((v) => (
              <button
                key={v.id}
                onClick={() => addClip(v)}
                title={`${v.author} · ${msToTimecode(v.durationMs)}`}
                style={{
                  background: "none", border: "1px solid var(--border)", borderRadius: 6,
                  padding: 0, cursor: "pointer", overflow: "hidden", position: "relative",
                }}
              >
                <img src={v.thumbnail} alt="" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", display: "block" }} />
                <span style={{
                  position: "absolute", bottom: 4, right: 4,
                  background: "rgba(0,0,0,0.7)", color: "#fff",
                  fontSize: 10, padding: "1px 4px", borderRadius: 3,
                }}>
                  {msToTimecode(v.durationMs)}
                </span>
                <span style={{
                  position: "absolute", top: 4, right: 4,
                  background: "var(--accent)", color: "#fff",
                  fontSize: 14, width: 20, height: 20, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>+</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Right: preview + inspector + timeline ---- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

        {/* Preview + Inspector row */}
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          padding: 20, gap: 20, overflow: "hidden",
        }}>
          {/* Video preview */}
          <div style={{
            width: 270, height: 480, borderRadius: 8, overflow: "hidden",
            background: "#000", flexShrink: 0, position: "relative",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {currentClip ? (
              <video
                ref={videoRef}
                key={currentClip.id}
                src={currentClip.pexelsUrl}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                controls
                onEnded={() => {
                  // Auto-advance to next clip
                  const next = playingClipIdx !== null ? playingClipIdx + 1 : null;
                  if (next !== null && next < project.clips.length) playClip(next);
                  else setPlayingClipIdx(null);
                }}
              />
            ) : (
              <div style={{ textAlign: "center", color: "#555" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>▶</div>
                <p style={{ fontSize: 12 }}>
                  {project.clips.length === 0 ? "Add clips to start" : "Click a clip to preview"}
                </p>
              </div>
            )}
          </div>

          {/* Inspector */}
          <div className="card" style={{ width: 200, alignSelf: "flex-start", flexShrink: 0 }}>
            <p style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>Inspector</p>
            {selectedClip ? (
              <>
                <img src={selectedClip.pexelsThumbnail} alt="" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", borderRadius: 4, marginBottom: 8 }} />
                <p style={{ fontSize: 11, marginBottom: 4 }}>Duration</p>
                <p className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{msToTimecode(selectedClip.durationMs)}</p>
                <p style={{ fontSize: 11, marginBottom: 4 }}>Source</p>
                <p className="muted" style={{ fontSize: 11, marginBottom: 8, wordBreak: "break-all" }}>Pexels · {selectedClip.pexelsAuthor}</p>
                <button
                  onClick={() => removeClip(selectedClip.id)}
                  style={{ width: "100%", background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 0", fontSize: 12, cursor: "pointer", color: "#e55" }}
                >
                  Remove clip
                </button>
              </>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Select a clip to edit its properties.</p>
                <hr style={{ borderColor: "var(--border)", margin: "8px 0" }} />
                <p style={{ fontSize: 12, marginBottom: 4 }}>Project</p>
                <p className="muted" style={{ fontSize: 11, marginBottom: 4 }}>1080 × 1920 · 30 fps · 9:16</p>
                <p className="muted" style={{ fontSize: 11 }}>
                  {project.clips.length} clip{project.clips.length !== 1 ? "s" : ""} · {msToTimecode(totalMs)}
                </p>
              </>
            )}
          </div>
        </div>

        {/* ---- Timeline ---- */}
        <div style={{
          borderTop: "1px solid var(--border)",
          background: "var(--panel)",
          padding: "12px 16px",
          minHeight: 160,
        }}>
          <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              Timeline · {msToTimecode(totalMs)}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => { setPlayingClipIdx(null); setTimeout(() => playClip(0), 50); }}
                disabled={project.clips.length === 0}
              >⏮ Play all</button>
            </div>
          </div>

          {project.clips.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, textAlign: "center", padding: "16px 0" }}>
              Search for videos above and click + to add clips here.
            </p>
          ) : (
            <div style={{ overflowX: "auto", paddingBottom: 8 }}>
              {/* Timecode ruler */}
              <div style={{ display: "flex", marginLeft: 8, marginBottom: 4, height: 16 }}>
                {Array.from({ length: Math.ceil(totalMs / 1000) + 1 }).map((_, i) => (
                  <div key={i} style={{ minWidth: PX_PER_SEC, fontSize: 9, color: "var(--muted)", borderLeft: "1px solid var(--border)", paddingLeft: 2 }}>
                    {i > 0 && msToTimecode(i * 1000)}
                  </div>
                ))}
              </div>

              {/* Video track */}
              <div className="row" style={{ gap: 0, alignItems: "stretch" }}>
                <span className="muted" style={{ width: 60, fontSize: 11, textAlign: "right", paddingRight: 8, paddingTop: 4, flexShrink: 0 }}>Video</span>
                <div style={{ display: "flex", gap: 2, flex: 1 }}>
                  {project.clips.map((clip, idx) => {
                    const widthPx = Math.max(40, (clip.durationMs / 1000) * PX_PER_SEC);
                    const isSelected = clip.id === selectedClipId;
                    return (
                      <div
                        key={clip.id}
                        draggable
                        onDragStart={() => onDragStart(clip.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => onDrop(clip.id)}
                        onClick={() => { setSelectedClipId(clip.id); playClip(idx); }}
                        title={`${clip.pexelsAuthor} · ${msToTimecode(clip.durationMs)}`}
                        style={{
                          width: widthPx,
                          height: TRACK_H,
                          borderRadius: 5,
                          overflow: "hidden",
                          cursor: "pointer",
                          border: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
                          flexShrink: 0,
                          position: "relative",
                          background: "#111",
                        }}
                      >
                        <img
                          src={clip.pexelsThumbnail}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", opacity: isSelected ? 1 : 0.75 }}
                        />
                        <span style={{
                          position: "absolute", bottom: 2, right: 3,
                          background: "rgba(0,0,0,0.65)", color: "#fff",
                          fontSize: 9, padding: "1px 3px", borderRadius: 2,
                        }}>
                          {msToTimecode(clip.durationMs)}
                        </span>
                        <span style={{
                          position: "absolute", top: 2, left: 3,
                          color: "#fff", fontSize: 9,
                          background: "rgba(0,0,0,0.5)", padding: "0 2px", borderRadius: 2,
                        }}>
                          {idx + 1}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Empty Voiceover / Captions tracks */}
              {["Voiceover", "Captions"].map((track) => (
                <div key={track} className="row" style={{ gap: 0, marginTop: 6 }}>
                  <span className="muted" style={{ width: 60, fontSize: 11, textAlign: "right", paddingRight: 8, flexShrink: 0 }}>{track}</span>
                  <div style={{
                    flex: 1, height: 28,
                    background: "var(--bg)", borderRadius: 4,
                    border: "1px dashed var(--border)",
                  }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
