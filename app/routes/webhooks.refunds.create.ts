import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatInvoiceNumber, getCurrentFinancialYear } from "../services/gst-engine";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const refund = payload as any;

  if (!refund || !refund.id || !refund.order_id) {
    return new Response("Invalid refund payload", { status: 400 });
  }

  const shopifyRefundId = String(refund.id);
  const existing = await prisma.creditNote.findUnique({ where: { shopifyRefundId } });
  if (existing) {
    return new Response("Credit note already exists", { status: 200 });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { shopifyOrderId: String(refund.order_id), shop },
  });

  if (!invoice) {
    return new Response("Invoice not found for refunded order", { status: 200 });
  }

  // Calculate refunded amount
  const totalRefundAmount = (refund.transactions || []).reduce(
    (sum: number, t: any) => (t.status === "success" ? sum + parseFloat(t.amount) : sum),
    0
  );

  // Restocks and other refunds with no money returned have nothing to credit.
  if (totalRefundAmount <= 0) {
    return new Response("No money refunded, no credit note needed", { status: 200 });
  }

  // Pro-rata tax reversal calculation
  const ratio = invoice.grandTotal > 0 ? Math.min(1, totalRefundAmount / invoice.grandTotal) : 1;
  const taxableAdjusted = Number((invoice.subtotalTaxable * ratio).toFixed(2));
  const cgstAdjusted = Number((invoice.cgstTotal * ratio).toFixed(2));
  const sgstAdjusted = Number((invoice.sgstTotal * ratio).toFixed(2));
  const igstAdjusted = Number((invoice.igstTotal * ratio).toFixed(2));

  try {
    await prisma.$transaction(async (tx) => {
      const counter = await tx.storeSetting.upsert({
        where: { shop },
        update: { nextCreditNoteNumber: { increment: 1 } },
        create: { shop, nextCreditNoteNumber: 2 },
      });

      await tx.creditNote.create({
        data: {
          shop,
          invoiceId: invoice.id,
          shopifyRefundId,
          creditNoteNumber: formatInvoiceNumber(
            counter.creditNotePrefix || "CN/{FY}/",
            counter.nextCreditNoteNumber - 1
          ),
          financialYear: getCurrentFinancialYear(),
          reason: refund.note || "Customer Refund / Return",
          taxableAdjusted,
          cgstAdjusted,
          sgstAdjusted,
          igstAdjusted,
          grandTotalAdjusted: Number(totalRefundAmount.toFixed(2)),
        },
      });
    });
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
  }

  return new Response("Credit note recorded", { status: 200 });
};
