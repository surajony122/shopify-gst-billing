import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createInvoiceForOrder, normalizeWebhookOrder } from "../services/invoice-builder.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);

  if (!payload || !payload.id) {
    return new Response("Invalid payload", { status: 400 });
  }

  // Also covers "on_create" stores if the earlier orders/create delivery was missed.
  const result = await createInvoiceForOrder(shop, normalizeWebhookOrder(payload), admin);
  return new Response(result.created ? "Invoice generated" : "Invoice already exists", { status: 200 });
};
