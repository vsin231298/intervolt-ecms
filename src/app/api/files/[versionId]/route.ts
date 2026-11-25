import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { readVersionForDownload } from "@/services/documents";
import { UserError } from "@/lib/errors";
import { prisma } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { versionId } = await params;
  try {
    const { version, data } = await readVersionForDownload(actor, versionId);
    const inline = new URL(req.url).searchParams.get("inline") === "1" && /^(image\/|application\/pdf)/.test(version.mimeType);
    await prisma.auditLog.create({ data: { userId: actor.id, action: "document.download", entityType: "Document", entityId: version.documentId, projectId: version.document.projectId, summary: `Downloaded ${version.fileName} (rev ${version.revision})` } });
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": version.mimeType || "application/octet-stream",
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(version.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    const status = e instanceof UserError ? (e.name === "ForbiddenError" ? 403 : 404) : 500;
    if (status === 500) console.error(e);
    return NextResponse.json({ error: e instanceof UserError ? e.message : "Could not read file" }, { status });
  }
}
