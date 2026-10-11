import { listProjectCards } from "@/lib/store";
import NewProjectForm from "./new-project-form";
import ProjectCardView from "./project-card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cards = await listProjectCards();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <div className="row" style={{ marginBottom: 32, justifyContent: "space-between", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>TikTok Studio</h1>
        <NewProjectForm />
      </div>

      {cards.length === 0 ? (
        <p className="muted">No projects yet. Create one above.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
          {cards.map((c) => (
            <ProjectCardView key={c.id} card={c} />
          ))}
        </div>
      )}
    </div>
  );
}
