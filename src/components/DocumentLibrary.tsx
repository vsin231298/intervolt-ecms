import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Download, Folder } from "lucide-react";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { can } from "@/lib/rbac";
import type { Actor } from "@/lib/actor";
import { Badge, Drawer, Empty, Field, StatusBadge, clsx } from "./ui";
import { ActionForm, Submit } from "./ActionForm";
import { fileSize } from "./DocList";
import { approvalAction, uploadAction } from "@/app/actions/documents";

export const COMPANY_CATEGORIES = ["Company certificate", "WSIB", "Insurance", "Safety", "Template / form", "Policy", "Employee certification", "Other"];

type Props = { actor: Actor; projectId?: string; companyOnly?: boolean; sp: { folder?: string; q?: string; module?: string; category?: string; filter?: string; scope?: string }; basePath: string };

/** Searchable, versioned document library for a job or for the whole company. */
export async function DocumentLibrary({ actor, projectId, companyOnly, sp, basePath }: Props) {
  const where: Prisma.DocumentWhereInput = {};
  if (projectId) where.projectId = projectId;
  else if (companyOnly) where.projectId = null;
  if (sp.folder) where.folderId = sp.folder;
  if (sp.module) where.module = sp.module;
  if (sp.category) where.category = sp.category;
  if (sp.filter === "expiring") where.expiresAt = { lte: new Date(Date.now() + 30 * 86_400_000) };
  if (sp.q) where.OR = [{ title: { contains: sp.q, mode: "insensitive" } }, { category: { contains: sp.q, mode: "insensitive" } }, { versions: { some: { fileName: { contains: sp.q, mode: "insensitive" } } } }, { project: { number: { contains: sp.q, mode: "insensitive" } } }];
  const [docs, folders, categories] = await Promise.all([
    prisma.document.findMany({ where, include: { versions: { orderBy: { revision: "desc" }, include: { uploadedBy: true } }, folder: true, project: true, worker: true }, orderBy: { updatedAt: "desc" }, take: 300 }),
    projectId ? prisma.documentFolder.findMany({ where: { projectId }, include: { _count: { select: { documents: true } } }, orderBy: { sortOrder: "asc" } }) : Promise.resolve([]),
    prisma.document.findMany({ where: projectId ? { projectId } : companyOnly ? { projectId: null } : {}, distinct: ["category"], select: { category: true } }),
  ]);
  const canUpload = can(actor.role, "documents.upload") && (projectId ? true : can(actor.role, "company.documents"));
  const canApprove = can(actor.role, "documents.approve");
  const q = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams(Object.entries({ ...sp, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `${basePath}?${u.toString()}`;
  };
  return (
    <div className={clsx("grid gap-6", projectId && "lg:grid-cols-[14rem_1fr]")}>
      {projectId ? (
        <aside className="card h-fit p-2">
          <Link href={q({ folder: undefined })} className={clsx("flex items-center gap-2 rounded px-2 py-1.5 text-sm", !sp.folder ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50")}><Folder className="h-4 w-4" /> All documents</Link>
          {folders.map((f) => (
            <Link key={f.id} href={q({ folder: f.id })} className={clsx("flex items-center gap-2 rounded px-2 py-1.5 text-sm", sp.folder === f.id ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50")}>
              <Folder className="h-4 w-4 text-amber-500" /><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-slate-400">{f._count.documents}</span>
            </Link>
          ))}
        </aside>
      ) : null}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
          <form action={basePath} className="flex flex-wrap gap-2">
            {sp.folder ? <input type="hidden" name="folder" value={sp.folder} /> : null}
            {sp.scope ? <input type="hidden" name="scope" value={sp.scope} /> : null}
            <input name="q" defaultValue={sp.q} placeholder="Search title, file name, WO #…" className="input w-60" />
            <select name="category" defaultValue={sp.category ?? ""} className="input w-48">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.category}>{c.category}</option>)}
            </select>
            {!projectId ? <select name="filter" defaultValue={sp.filter ?? ""} className="input w-44"><option value="">Any expiry</option><option value="expiring">Expired / expiring 30 days</option></select> : null}
            <button className="btn btn-secondary">Search</button>
          </form>
          {canUpload ? (
            <div className="ml-auto">
              <Drawer label="Upload documents" className="btn btn-primary btn-sm">
                <ActionForm action={uploadAction} className="space-y-3">
                  {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                  <Field label="Files *"><input type="file" name="files" multiple required className="text-sm" /></Field>
                  {projectId ? (
                    <Field label="Folder"><select name="folderId" defaultValue={sp.folder ?? ""} className="input"><option value="">Auto (by module)</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
                  ) : null}
                  <Field label="Category *">
                    <input name="category" list="doc-categories" required defaultValue={projectId ? "Drawings" : "Company certificate"} className="input" />
                    <datalist id="doc-categories">
                      {(projectId ? ["Drawings", "Specifications", "Addendum", "Tender document", "Contract", "Correspondence", "Site photo", "As-built drawings", "O&M manual", "Warranty", "ESA certificate", "Other"] : COMPANY_CATEGORIES).map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </Field>
                  <Field label="Title (single file only)"><input name="title" className="input" /></Field>
                  {!projectId ? <Field label="Expiry date (certificates)"><input type="date" name="expiresAt" className="input" /></Field> : null}
                  <Field label="Note"><input name="note" className="input" /></Field>
                  <Submit>Upload</Submit>
                </ActionForm>
              </Drawer>
            </div>
          ) : null}
        </div>
        {docs.length === 0 ? <div className="p-4"><Empty>No documents found.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Document</th>{!projectId && !companyOnly ? <th>Job</th> : null}<th>Category</th><th>Rev</th><th>Status</th><th>Uploaded</th><th></th></tr></thead>
              <tbody>
                {docs.map((doc) => {
                  const v = doc.versions[0];
                  if (!v) return null;
                  const expired = doc.expiresAt && doc.expiresAt < new Date();
                  return (
                    <tr key={doc.id}>
                      <td>
                        <a href={`/api/files/${v.id}?inline=1`} target="_blank" rel="noreferrer" className="link">{doc.title}</a>
                        <div className="text-xs text-slate-500">{v.fileName} · {fileSize(v.sizeBytes)}{doc.folder ? ` · ${doc.folder.name}` : ""}{doc.worker ? ` · ${doc.worker.name}` : ""}</div>
                        {doc.expiresAt ? <div className={clsx("text-xs", expired ? "font-semibold text-red-600" : "text-slate-500")}>{expired ? "Expired" : "Expires"} {fmtDate(doc.expiresAt)}</div> : null}
                        {doc.versions.length > 1 ? (
                          <details className="mt-1 text-xs text-slate-500">
                            <summary>Version history ({doc.versions.length})</summary>
                            <ul className="mt-1 space-y-0.5">
                              {doc.versions.map((x) => <li key={x.id}><a className="link" href={`/api/files/${x.id}`}>rev {x.revision}{x.revisionLabel ? ` (${x.revisionLabel})` : ""}</a> · {x.uploadedBy.name} · {fmtDateTime(x.uploadedAt)} · {x.approvalStatus.toLowerCase()}{x.note ? ` · ${x.note}` : ""}</li>)}
                            </ul>
                          </details>
                        ) : null}
                      </td>
                      {!projectId && !companyOnly ? <td className="whitespace-nowrap text-xs">{doc.project ? <Link className="link" href={`/jobs/${doc.project.id}/documents`}>{doc.project.number}</Link> : <Badge>Company</Badge>}</td> : null}
                      <td className="text-xs">{doc.category}</td>
                      <td className="text-xs">{v.revision}</td>
                      <td>{v.approvalStatus === "NONE" ? <span className="text-xs text-slate-400">—</span> : <StatusBadge status={v.approvalStatus} />}</td>
                      <td className="whitespace-nowrap text-xs">{v.uploadedBy.name}<div className="text-slate-500">{fmtDateTime(v.uploadedAt)}</div></td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <a href={`/api/files/${v.id}`} className="btn btn-ghost btn-sm" aria-label="Download"><Download className="h-4 w-4" /></a>
                          {canUpload ? (
                            <Drawer label="New revision" className="btn btn-ghost btn-sm">
                              <ActionForm action={uploadAction} className="space-y-3">
                                <input type="hidden" name="documentId" value={doc.id} />
                                {doc.projectId ? <input type="hidden" name="projectId" value={doc.projectId} /> : null}
                                <input type="hidden" name="category" value={doc.category} />
                                <p className="text-xs text-slate-500">The current file stays in the history; nothing is overwritten.</p>
                                <Field label="File *"><input type="file" name="files" required className="text-sm" /></Field>
                                <Field label="Revision label"><input name="revisionLabel" placeholder="e.g. Rev B, IFC" className="input" /></Field>
                                {doc.expiresAt !== null || !doc.projectId ? <Field label="New expiry date"><input type="date" name="expiresAt" className="input" /></Field> : null}
                                <Field label="Note"><input name="note" className="input" /></Field>
                                <Submit>Upload revision</Submit>
                              </ActionForm>
                            </Drawer>
                          ) : null}
                          {canApprove && v.approvalStatus !== "APPROVED" ? (
                            <ActionForm action={approvalAction}><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="status" value="APPROVED" /><Submit className="btn btn-ghost btn-sm text-emerald-700" pendingText="…">Approve</Submit></ActionForm>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
