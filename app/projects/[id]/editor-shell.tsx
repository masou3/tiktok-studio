"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Player } from "@remotion/player";
import { EmptyTimeline } from "@/remotion/EmptyTimeline";
import type { Project } from "@/lib/types";

export default function EditorShell({ project: initial }: { project: Project }) {
  const [project, setProject] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);

  async function saveTitle() {
    if (title === project.title) return;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const updated = await res.json();
      setProject(updated);
    }
  }

  async function deleteProject() {
    if (!confirm("Delete this project? This cannot be undone.")) return;
    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    router.push("/");
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Chat panel */}
      <div
        style={{
          width: 340,
          minWidth: 280,
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel)",
        }}
      >
        <div
          className="row"
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            justifyContent: "space-between",
          }}
        >
          <a href="/" style={{ color: "var(--muted)", fontSize: 18 }}>←</a>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            style={{
              flex: 1,
              margin: "0 12px",
              fontWeight: 600,
              background: "transparent",
              border: "none",
              borderBottom: "1px solid transparent",
              borderRadius: 0,
              padding: "2px 4px",
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderBottomColor = "var(--accent)")
            }
          />
          <button
            onClick={deleteProject}
            style={{
              background: "none",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            🗑
          </button>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <p className="muted" style={{ textAlign: "center", fontSize: 13 }}>
            Chat with Claude coming soon.
            <br />
            <br />
            Type a brief like "45 seconds, why sourdough fails, calm voice" and Claude will build the video.
          </p>
        </div>

        <div
          style={{
            padding: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <input placeholder="Message Claude…" disabled style={{ opacity: 0.4 }} />
        </div>
      </div>

      {/* Right: preview + timeline */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Preview row */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            gap: 24,
            overflow: "hidden",
          }}
        >
          <Player
            component={EmptyTimeline}
            durationInFrames={30}
            fps={30}
            compositionWidth={1080}
            compositionHeight={1920}
            style={{ height: 480, width: 270, borderRadius: 8, overflow: "hidden" }}
            controls
          />

          {/* Inspector */}
          <div className="card" style={{ width: 220, alignSelf: "flex-start" }}>
            <p style={{ fontWeight: 600, marginBottom: 12 }}>Inspector</p>
            <p className="muted" style={{ fontSize: 12 }}>Select a clip to edit its properties.</p>
            <hr style={{ borderColor: "var(--border)", margin: "12px 0" }} />
            <p style={{ fontSize: 12, marginBottom: 4 }}>Project</p>
            <p className="muted" style={{ fontSize: 11 }}>1080 × 1920 · 30 fps · 9:16</p>
          </div>
        </div>

        {/* Timeline */}
        <div
          style={{
            height: 180,
            borderTop: "1px solid var(--border)",
            background: "var(--panel)",
            padding: 16,
          }}
        >
          <div className="row" style={{ marginBottom: 12, justifyContent: "space-between" }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Timeline</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }}>⏮</button>
              <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }}>▶</button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {["Video", "Voiceover", "Captions"].map((track) => (
              <div key={track} className="row" style={{ gap: 8 }}>
                <span className="muted" style={{ width: 72, fontSize: 11, textAlign: "right" }}>{track}</span>
                <div
                  style={{
                    flex: 1,
                    height: 28,
                    background: "var(--bg)",
                    borderRadius: 4,
                    border: "1px dashed var(--border)",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
