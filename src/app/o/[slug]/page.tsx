import { Suspense } from "react";
import { createProjectAction, deleteProjectAction } from "@/app/actions/orgs";
import { ActionForm, Field } from "@/components/action-form";
import { Card, Skeleton, formatDate } from "@/components/ui";
import { requireOrg } from "@/lib/auth/session";
import { getPlan } from "@/lib/billing/plans";
import { can } from "@/lib/permissions";
import { listProjects } from "@/lib/services/projects";

export const metadata = { title: "Projects" };

export default function ProjectsPage({ params }: PageProps<"/o/[slug]">) {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <Projects params={params} />
    </Suspense>
  );
}

async function Projects({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const projects = await listProjects(ctx);
  const limit = getPlan(ctx.org.plan).limits.projects;
  const canDelete = can(ctx.role, "projects:delete");

  return (
    <div className="space-y-6">
      <Card
        title="Projects"
        description={
          limit === Infinity
            ? "Stored in this organization’s own schema. Other organizations can’t see them."
            : `${projects.length} of ${limit} projects on the Free plan. Stored in this organization’s own schema.`
        }
      >
        {projects.length === 0 ? (
          <p className="text-sm text-slate-500">No projects yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {projects.map((project) => (
              <li key={project.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{project.name}</p>
                  {project.description && <p className="text-sm text-slate-600">{project.description}</p>}
                  <p className="mt-1 text-xs text-slate-400">Created {formatDate(project.createdAt)}</p>
                </div>
                {canDelete && (
                  <ActionForm
                    action={deleteProjectAction.bind(null, slug)}
                    submitLabel="Delete"
                    pendingLabel="Deleting…"
                    variant="secondary"
                    className="shrink-0"
                    confirm={`Delete "${project.name}"?`}
                  >
                    <input type="hidden" name="projectId" value={project.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="New project">
        <ActionForm action={createProjectAction.bind(null, slug)} submitLabel="Add project" pendingLabel="Adding…">
          <Field label="Name" name="name" />
          <Field label="Description" name="description" required={false} />
        </ActionForm>
      </Card>
    </div>
  );
}
