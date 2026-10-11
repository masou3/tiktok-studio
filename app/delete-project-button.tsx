"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// An X in the corner of a project card. First click asks "Delete?", second click deletes.
export default function DeleteProjectButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    await fetch(`/api/projects/${id}`, { method: "DELETE" }).catch(() => null);
    router.refresh();
  }

  const base = {
    position: "absolute" as const,
    top: 8,
    right: 8,
    zIndex: 2,
    border: "none",
    cursor: "pointer",
    borderRadius: 999,
    fontSize: 13,
    lineHeight: 1,
    background: "rgba(0,0,0,0.65)",
    color: "#fff",
  };

  if (confirming) {
    return (
      <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2, display: "flex", gap: 6 }}>
        <button
          onClick={remove}
          disabled={busy}
          aria-label={`Confirm delete ${title}`}
          style={{ ...base, position: "static", padding: "6px 10px", background: "#fe2c55", fontWeight: 600 }}
        >
          {busy ? "Deleting..." : "Delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          aria-label="Cancel"
          style={{ ...base, position: "static", padding: "6px 10px" }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      aria-label={`Delete ${title}`}
      title="Delete project"
      style={{ ...base, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      ✕
    </button>
  );
}
