import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, isoDate, today } from "@/lib/dates";
import { d, money, sum } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { Card, Drawer, Empty, Field, Notice, Options, Progress, Stat, StatusBadge, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { billingLinesWithProgress, invoiceBalance, projectFinancials } from "@/services/billing";
import { createDrawAction, drawOpAction, holdbackReleaseAction, invoiceOpAction, manualInvoiceAction, paymentAction, sovAction } from "@/app/actions/billing";

export default async function BillingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("financials.view");
  const { id } = await params;
  const [fin, lines, draws, invoices, clientPos, cos, project, drawDay] = await Promise.all([
    projectFinancials(id),
    billingLinesWithProgress(id),
    prisma.progressDraw.findMany({ where: { projectId: id }, include: { lines: { include: { billingLine: true } }, invoice: true }, orderBy: { drawNumber: "desc" } }),
    prisma.invoice.findMany({ where: { projectId: id }, include: { payments: { orderBy: { receivedAt: "asc" } }, clientPo: true, changeOrder: true }, orderBy: { invoiceDate: "desc" } }),
    prisma.clientPO.findMany({ where: { projectId: id }, orderBy: { createdAt: "asc" } }),
    prisma.changeOrder.findMany({ where: { projectId: id, status: "APPROVED" }, include: { billingLine: true }, orderBy: { number: "asc" } }),
    prisma.project.findUniqueOrThrow({ where: { id } }),
    getSetting("billing.drawDueDay"),
  ]);
  const r = user.role;
  const canPrep = can(r, "billing.prepare") && project.stage !== "CLOSED";
  const canBill = can(r, "billing.edit");
  const t0 = today();
  const poOpts = clientPos.map((p) => ({ value: p.id, label: `${p.poNumber} (${money(p.amount)})` }));
  const baseLines = lines.filter((l) => !l.line.changeOrderId);
  const openDraft = draws.find((dr) => dr.status !== "INVOICED");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Revised contract" value={money(fin.currentValue)} sub={`original ${money(fin.originalValue)}`} />
        <Stat label="Billed to date" value={money(fin.billed)} sub={`${fin.billedPercent.toFixed(1)}% of contract`} />
        <Stat label="Received" value={money(fin.received)} />
        <Stat label="Outstanding AR" value={money(fin.outstanding)} tone={fin.outstanding.greaterThan(0) ? "amber" : undefined} />
        <Stat label="Holdback retained" value={money(fin.holdbackRetained)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cost to date" value={money(fin.cost)} sub={`material ${money(fin.materialActual)} · labour ${money(fin.labourActual)}`} />
        <Stat label="Estimated cost" value={money(fin.estCost)} tone={fin.cost.greaterThan(fin.estCost) && !fin.estCost.isZero() ? "red" : undefined} />
        <Stat label="Margin (on revised contract)" value={money(fin.margin)} sub={`${fin.marginPercent.toFixed(1)}%`} tone={fin.margin.lessThan(0) ? "red" : "green"} />
        <Stat label="Owed to suppliers" value={money(fin.supplierOwed)} href={`/finance?tab=payables`} />
      </div>

      <Card title="Schedule of values" bodyClass="overflow-x-auto" actions={canPrep ? (
        <Drawer label={baseLines.length > 1 ? "Edit base breakdown" : "Break down base contract"} className="btn btn-secondary btn-sm" wide>
          <ActionForm action={sovAction} className="space-y-3" resetOnSuccess={false}>
            <input type="hidden" name="projectId" value={id} />
            <p className="text-sm text-slate-600">Split the original contract ({money(fin.originalValue)}) into billing items. Values must add up to the original contract value. Lines already billed can't be removed.</p>
            <table className="table">
              <thead><tr><th>Description</th><th className="w-40">Value ($)</th></tr></thead>
              <tbody>
                {Array.from({ length: Math.max(baseLines.length + 4, 6) }, (_, i) => (
                  <tr key={i}>
                    <td><input name="sov_description" defaultValue={baseLines[i]?.line.description} className="input py-1" aria-label={`Item ${i + 1}`} /></td>
                    <td><input name="sov_value" defaultValue={baseLines[i]?.line.scheduledValue.toString()} inputMode="decimal" className="input py-1" aria-label={`Value ${i + 1}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Submit>Save schedule of values</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {lines.length === 0 ? <div className="p-4"><Empty>No billing lines yet. They are created when the job is awarded.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Item</th><th className="num">Scheduled value</th><th className="num">Billed to date</th><th className="w-40">Progress</th><th className="num">Remaining</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.line.id}>
                  <td>{l.line.description}{l.line.changeOrderId ? <span className="ml-1 text-xs text-slate-500">(change order)</span> : null}</td>
                  <td className="num">{money(l.line.scheduledValue)}</td>
                  <td className="num">{money(l.billed)}</td>
                  <td><Progress value={Number(l.percent)} tone={l.percent.greaterThanOrEqualTo(100) ? "green" : "blue"} /><div className="text-right text-xs text-slate-500">{l.percent.toFixed(1)}%</div></td>
                  <td className="num">{money(l.remaining)}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td>Total</td><td className="num">{money(sum(lines.map((l) => l.line.scheduledValue)))}</td><td className="num">{money(sum(lines.map((l) => l.billed)))}</td><td></td><td className="num">{money(sum(lines.map((l) => l.remaining)))}</td></tr>
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Progress draws (due day ${drawDay} of each month)`} bodyClass="overflow-x-auto" actions={canPrep && lines.length && !openDraft ? (
        <Drawer label="Prepare draw" className="btn btn-primary btn-sm" wide>
          <ActionForm action={createDrawAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period ending *"><input type="date" name="periodEnd" required defaultValue={isoDate(t0)} className="input" /></Field>
              <Field label="Notes"><input name="notes" className="input" /></Field>
            </div>
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Value</th><th className="num">Previously</th><th className="w-32">% complete to date</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.line.id}>
                    <td>{l.line.description}</td>
                    <td className="num">{money(l.line.scheduledValue)}</td>
                    <td className="num">{l.percent.toFixed(1)}%</td>
                    <td><input name={`pct_${l.line.id}`} defaultValue={l.percent.toFixed(1)} inputMode="decimal" className="input py-1" aria-label={`Percent complete for ${l.line.description}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">Holdback of {project.holdbackPercent.toString()}% is deducted automatically.</p>
            <Submit>Prepare draw</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {draws.length === 0 ? <div className="p-4"><Empty>No draws yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Draw</th><th>Period end</th><th>Status</th><th className="num">This period</th><th className="num">Holdback</th><th>Invoice</th><th></th></tr></thead>
            <tbody>
              {draws.map((dr) => (
                <tr key={dr.id}>
                  <td>#{dr.drawNumber}<details className="text-xs text-slate-500"><summary className="cursor-pointer">Lines</summary><ul>{dr.lines.map((l) => <li key={l.id}>{l.billingLine.description}: {money(l.thisPeriodAmount)}</li>)}</ul></details></td>
                  <td>{fmtDate(dr.periodEnd)}</td>
                  <td><StatusBadge status={dr.status} /></td>
                  <td className="num">{money(dr.thisPeriod)}</td>
                  <td className="num">{money(dr.holdback)}</td>
                  <td>{dr.invoice ? <a className="link" href={`#${dr.invoice.id}`}>{dr.invoice.number}</a> : "—"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {dr.status === "DRAFT" && canPrep ? <>
                        <ActionForm action={drawOpAction}><input type="hidden" name="drawId" value={dr.id} /><input type="hidden" name="op" value="SUBMITTED" /><Submit className="btn btn-secondary btn-sm" pendingText="…">Mark submitted</Submit></ActionForm>
                        <ActionForm action={drawOpAction}><input type="hidden" name="drawId" value={dr.id} /><input type="hidden" name="op" value="delete" /><Submit className="btn btn-ghost btn-sm text-red-600" pendingText="…">Delete</Submit></ActionForm>
                      </> : null}
                      {dr.status === "SUBMITTED" && canPrep ? <ActionForm action={drawOpAction}><input type="hidden" name="drawId" value={dr.id} /><input type="hidden" name="op" value="APPROVED" /><Submit className="btn btn-success btn-sm" pendingText="…">Client approved</Submit></ActionForm> : null}
                      {["SUBMITTED", "APPROVED"].includes(dr.status) && canBill ? (
                        <Drawer label="Create invoice" className="btn btn-primary btn-sm">
                          <ActionForm action={drawOpAction} className="space-y-2">
                            <input type="hidden" name="drawId" value={dr.id} /><input type="hidden" name="op" value="invoice" />
                            <Field label="Invoice date *"><input type="date" name="invoiceDate" required defaultValue={isoDate(t0)} className="input" /></Field>
                            <Field label="Client PO"><select name="clientPoId" className="input"><Options items={poOpts} empty="—" /></select></Field>
                            <Submit>Create invoice</Submit>
                          </ActionForm>
                        </Drawer>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Client invoices" bodyClass="overflow-x-auto" actions={canBill ? (
        <div className="flex gap-2">
          <Drawer label="Manual invoice" className="btn btn-secondary btn-sm">
            <ActionForm action={manualInvoiceAction} className="space-y-3">
              <input type="hidden" name="projectId" value={id} />
              <Field label="Description *"><input name="description" required className="input" placeholder="Service call, T&M, extra work…" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Invoice date *"><input type="date" name="invoiceDate" required defaultValue={isoDate(t0)} className="input" /></Field>
                <Field label="Amount before tax ($) *"><input name="amount" required className="input" /></Field>
                <Field label="Client PO"><select name="clientPoId" className="input"><Options items={poOpts} empty="—" /></select></Field>
                <Field label="For change order"><select name="changeOrderId" className="input"><Options items={cos.map((c) => ({ value: c.id, label: `${c.number} ${money(c.approvedAmount ?? 0)}` }))} empty="—" /></select></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="applyHoldback" /> Deduct holdback</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFinal" /> Final invoice</label>
              <Submit>Create draft invoice</Submit>
            </ActionForm>
          </Drawer>
          {fin.holdbackRetained.greaterThan(0) ? (
            <Drawer label="Release holdback" className="btn btn-secondary btn-sm">
              <ActionForm action={holdbackReleaseAction} className="space-y-2">
                <input type="hidden" name="projectId" value={id} />
                <p className="text-sm">Invoice the retained holdback of {money(fin.holdbackRetained)}.</p>
                <Field label="Invoice date *"><input type="date" name="invoiceDate" required defaultValue={isoDate(t0)} className="input" /></Field>
                <Submit>Create holdback release invoice</Submit>
              </ActionForm>
            </Drawer>
          ) : null}
        </div>
      ) : null}>
        {invoices.length === 0 ? <div className="p-4"><Empty>No invoices yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Invoice</th><th>Date / due</th><th>For</th><th className="num">Subtotal</th><th className="num">Holdback</th><th className="num">Tax</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {invoices.map((inv) => {
                const bal = invoiceBalance(inv);
                const overdue = bal.greaterThan(0) && inv.dueDate < t0;
                return (
                  <tr key={inv.id} id={inv.id}>
                    <td className="font-mono text-xs"><a className="link" href={`/api/export/invoice/${inv.id}`} target="_blank" rel="noreferrer">{inv.number}</a>{inv.isFinal ? <div className="font-sans text-emerald-700">Final</div> : null}</td>
                    <td className={clsx("text-xs", overdue && "font-semibold text-red-600")}>{fmtDate(inv.invoiceDate)}<div>due {fmtDate(inv.dueDate)}{overdue ? " (overdue)" : ""}</div></td>
                    <td className="text-xs">{inv.isHoldbackRelease ? "Holdback release" : inv.drawId ? "Progress draw" : inv.changeOrder ? <Link className="link" href={`/jobs/${id}/changes/${inv.changeOrder.id}`}>{inv.changeOrder.number}</Link> : inv.description}{inv.clientPo ? <div className="text-slate-500">PO {inv.clientPo.poNumber}</div> : null}</td>
                    <td className="num">{money(inv.subtotal)}</td>
                    <td className="num">{d(inv.holdback).isZero() ? "—" : `(${money(inv.holdback)})`}</td>
                    <td className="num">{money(inv.tax)}</td>
                    <td className="num font-medium">{money(inv.total)}{inv.approvedAmount ? <div className="text-xs text-slate-500">approved {money(inv.approvedAmount)}</div> : null}</td>
                    <td className="num">{money(inv.paidAmount)}</td>
                    <td className="num">{money(bal)}</td>
                    <td><StatusBadge status={inv.status} /></td>
                    <td>
                      {canBill ? (
                        <div className="flex flex-wrap gap-1">
                          {inv.status === "DRAFT" ? <ActionForm action={invoiceOpAction}><input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="op" value="SUBMIT" /><Submit className="btn btn-primary btn-sm" pendingText="…">Send to client</Submit></ActionForm> : null}
                          {inv.status === "SUBMITTED" ? (
                            <Drawer label="Client approved" className="btn btn-secondary btn-sm">
                              <ActionForm action={invoiceOpAction} className="space-y-2"><input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="op" value="APPROVE" /><Field label="Approved amount ($)" hint="Blank = full amount"><input name="approvedAmount" placeholder={inv.total.toString()} className="input" /></Field><Submit>Save</Submit></ActionForm>
                            </Drawer>
                          ) : null}
                          {["SUBMITTED", "APPROVED", "PARTIALLY_PAID"].includes(inv.status) ? (
                            <Drawer label="Record payment" className="btn btn-success btn-sm">
                              <ActionForm action={paymentAction} className="space-y-2">
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <Field label="Received on *"><input type="date" name="receivedAt" required defaultValue={isoDate(t0)} className="input" /></Field>
                                <Field label="Amount ($) *"><input name="amount" required defaultValue={bal.toFixed(2)} className="input" /></Field>
                                <Field label="Method"><select name="method" className="input"><option>EFT</option><option>Cheque</option><option>Wire</option><option>Credit card</option><option>Cash</option></select></Field>
                                <Field label="Reference"><input name="reference" className="input" /></Field>
                                <Submit>Record payment</Submit>
                              </ActionForm>
                            </Drawer>
                          ) : null}
                          {!inv.isFinal && inv.status !== "VOID" && inv.status !== "DRAFT" ? <ActionForm action={invoiceOpAction}><input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="op" value="MARK_FINAL" /><Submit className="btn btn-ghost btn-sm" pendingText="…">Mark final</Submit></ActionForm> : null}
                          {["DRAFT", "SUBMITTED"].includes(inv.status) && d(inv.paidAmount).isZero() ? (
                            <Drawer label="Void" className="btn btn-ghost btn-sm text-red-600">
                              <ActionForm action={invoiceOpAction} className="space-y-2"><input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="op" value="VOID" /><Field label="Reason *"><input name="reason" required className="input" /></Field><Submit className="btn btn-danger">Void invoice</Submit></ActionForm>
                            </Drawer>
                          ) : null}
                        </div>
                      ) : null}
                      {inv.payments.length ? <details className="text-xs text-slate-500"><summary className="cursor-pointer">{inv.payments.length} payment(s)</summary><ul>{inv.payments.map((p) => <li key={p.id}>{fmtDate(p.receivedAt)} {money(p.amount)} {p.method} {p.reference}</li>)}</ul></details> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Client purchase orders">
        {clientPos.length === 0 ? <Notice>No client POs recorded.</Notice> : (
          <ul className="space-y-1 text-sm">{clientPos.map((p) => <li key={p.id}><b>{p.poNumber}</b> · {fmtDate(p.poDate)} · {money(p.amount)}{p.description ? ` · ${p.description}` : ""}</li>)}</ul>
        )}
      </Card>
    </div>
  );
}
