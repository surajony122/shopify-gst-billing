import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatInvoiceNumber, getCurrentFinancialYear } from "../services/gst-engine.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const refund = payload as any;

  if (!refund || !refund.id || !refund.order_id) {
    return new Response("Invalid refund payload", { status: 400 });
  }

  const orderId = String(refund.order_id);
  const invoice = await prisma.invoice.findUnique({
    where: { shopifyOrderId: orderId },
  });

  if (!invoice) {
    return new Response("Invoice not found for refunded order", { status: 200 });
  }

  const setting = await prisma.storeSetting.findUnique({ where: { shop } });
  const nextSeq = setting?.nextCreditNoteNumber || 1;
  const prefix = setting?.creditNotePrefix || "CN/{FY}/";
  const creditNoteNumber = formatInvoiceNumber(prefix, nextSeq);
  const financialYear = getCurrentFinancialYear();

  // Calculate refunded amount
  const totalRefundAmount = (refund.transactions || []).reduce(
    (sum: number, t: any) => (t.status === "success" ? sum + parseFloat(t.amount) : sum),
    0
  );

  // Pro-rata tax reversal calculation
  const ratio = invoice.grandTotal > 0 ? Math.min(1, totalRefundAmount / invoice.grandTotal) : 1;
  const taxableAdjusted = Number((invoice.subtotalTaxable * ratio).toFixed(2));
  const cgstAdjusted = Number((invoice.cgstTotal * ratio).toFixed(2));
  const sgstAdjusted = Number((invoice.sgstTotal * ratio).toFixed(2));
  const igstAdjusted = Number((invoice.igstTotal * ratio).toFixed(2));

  await prisma.$transaction([
    prisma.creditNote.create({
      data: {
        shop,
        invoiceId: invoice.id,
        shopifyRefundId: String(refund.id),
        creditNoteNumber,
        financialYear,
        reason: refund.note || "Customer Refund / Return",
        taxableAdjusted,
        cgstAdjusted,
        sgstAdjusted,
        igstAdjusted,
        grandTotalAdjusted: totalRefundAmount || invoice.grandTotal,
      },
    }),
    prisma.storeSetting.upsert({
      where: { shop },
      update: { nextCreditNoteNumber: nextSeq + 1 },
      create: { shop, nextCreditNoteNumber: nextSeq + 1 },
    }),
  ]);

  return new Response("Credit note recorded", { status: 200 });
};
