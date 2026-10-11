import Link from "next/link";
import { listProjects } from "@/lib/store";
import NewProjectForm from "./new-project-form";
import DeleteProjectButton from "./delete-project-button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await listProjects();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <div className="row" style={{ marginBottom: 32, justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>TikTok Studio</h1>
        <NewProjectForm />
      </div>

      {projects.length === 0 ? (
        <p className="muted">No projects yet. Create one above.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
          {projects.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
            <DeleteProjectButton id={p.id} title={p.title} />
            <Link href={`/projects/${p.id}`}>
              <div className="card project-card">
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "9/16",
                    background: "var(--bg)",
                    borderRadius: 4,
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span className="muted" style={{ fontSize: 24 }}>▶</span>
                </div>
                <p style={{ fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.title}
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  {new Date(p.updatedAt).toLocaleDateString()}
                </p>
              </div>
            </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
