import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createCreditNote } from "../services/invoice-builder.server";

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

  // A cancelled invoice is already out of the GST return, so there is nothing to reverse.
  if (invoice.status === "CANCELLED") {
    return new Response("Invoice already cancelled", { status: 200 });
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

  const created = await createCreditNote(shop, invoice, {
    shopifyRefundId,
    amount: totalRefundAmount,
    reason: refund.note || "Customer Refund / Return",
  });
  if (!created) {
    return new Response("Invoice already fully credited", { status: 200 });
  }

  return new Response("Credit note recorded", { status: 200 });
};
