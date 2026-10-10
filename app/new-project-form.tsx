"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewProjectForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled video" }),
    });
    if (res.ok) {
      const { id } = await res.json();
      router.push(`/projects/${id}`);
    } else {
      setLoading(false);
    }
  }

  return (
    <button className="primary" onClick={handleCreate} disabled={loading}>
      {loading ? "Creating…" : "+ New video"}
    </button>
  );
}
