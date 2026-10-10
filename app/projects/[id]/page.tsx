import { notFound } from "next/navigation";
import { getProject } from "@/lib/store";
import EditorShell from "./editor-shell";

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) notFound();
  return <EditorShell project={project} />;
}
