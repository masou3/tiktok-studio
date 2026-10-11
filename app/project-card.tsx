"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProjectCard } from "@/lib/types";

function fmt(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const iconBtn = {
  border: "none",
  cursor: "pointer",
  borderRadius: 999,
  fontSize: 13,
  lineHeight: 1,
  background: "rgba(0,0,0,0.65)",
  color: "#fff",
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

const pill = {
  fontSize: 10,
  fontWeight: 600,
  padding: "2px 6px",
  borderRadius: 999,
  background: "rgba(0,0,0,0.65)",
  color: "#fff",
} as const;

export default function ProjectCardView({ card }: { card: ProjectCard }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(card.title);

  async function remove() {
    setBusy(true);
    await fetch(`/api/projects/${card.id}`, { method: "DELETE" }).catch(() => null);
    router.refresh();
  }

  async function duplicate() {
    setBusy(true);
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duplicateOf: card.id }),
    }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  async function saveName() {
    setRenaming(false);
    const next = name.trim();
    if (!next || next === card.title) {
      setName(card.title);
      return;
    }
    await fetch(`/api/projects/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    }).catch(() => null);
    router.refresh();
  }

  return (
    <div style={{ position: "relative", opacity: busy ? 0.6 : 1 }}>
      <div style={{ position: "absolute", top: 24, right: 24, zIndex: 2, display: "flex", gap: 6 }}>
        {confirming ? (
          <>
            <button onClick={remove} disabled={busy} aria-label={`Confirm delete ${card.title}`} style={{ ...iconBtn, width: "auto", padding: "0 10px", height: 26, background: "#fe2c55", fontWeight: 600 }}>
              {busy ? "Deleting..." : "Delete"}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} aria-label="Cancel" style={{ ...iconBtn, width: "auto", padding: "0 10px" }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={duplicate} disabled={busy} aria-label={`Duplicate ${card.title}`} title="Duplicate project" style={iconBtn}>⧉</button>
            <button onClick={() => setConfirming(true)} aria-label={`Delete ${card.title}`} title="Delete project" style={iconBtn}>✕</button>
          </>
        )}
      </div>

      <Link href={`/projects/${card.id}`} style={{ display: "block" }}>
        <div className="card project-card" style={{ paddingBottom: 62 }}>
          <div style={{ position: "relative", width: "100%", aspectRatio: "9/16", background: "var(--bg)", borderRadius: 4, marginBottom: 12, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {card.thumb?.kind === "video" && (
              <video src={`${card.thumb.url}#t=0.5`} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            )}
            {card.thumb?.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.thumb.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            )}
            {!card.thumb && <span className="muted" style={{ fontSize: 24 }}>▶</span>}
            <div style={{ position: "absolute", left: 6, bottom: 6, right: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {card.clipCount > 0 && <span style={pill}>{fmt(card.durationMs)} · {card.clipCount} clip{card.clipCount === 1 ? "" : "s"}</span>}
              {card.hasVoice && <span style={pill}>Voice</span>}
              {card.spentCents > 0 && <span style={pill}>AI ${(card.spentCents / 100).toFixed(2)}</span>}
            </div>
          </div>
        </div>
      </Link>

      <div style={{ position: "absolute", left: 16, right: 16, bottom: 14 }}>
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(card.title);
                setRenaming(false);
              }
            }}
            aria-label="Project name"
            style={{ width: "100%", fontWeight: 600, fontSize: 14, padding: "2px 6px" }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <p style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{card.title}</p>
            <button onClick={() => setRenaming(true)} aria-label={`Rename ${card.title}`} title="Rename" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}>✎</button>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>{new Date(card.updatedAt).toLocaleDateString()}</p>
      </div>
    </div>
  );
}
