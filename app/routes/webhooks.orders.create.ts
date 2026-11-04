import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createInvoiceForOrder, normalizeWebhookOrder } from "../services/invoice-builder.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);

  if (!payload || !payload.id) {
    return new Response("Invalid payload", { status: 400 });
  }

  const setting = await prisma.storeSetting.findUnique({ where: { shop } });
  if ((setting?.autoGenerateTrigger || "on_fulfill") !== "on_create") {
    return new Response("Invoice will be generated on fulfillment", { status: 200 });
  }

  const result = await createInvoiceForOrder(shop, normalizeWebhookOrder(payload), admin);
  return new Response(result.created ? "Invoice generated" : "Invoice already exists", { status: 200 });
};
