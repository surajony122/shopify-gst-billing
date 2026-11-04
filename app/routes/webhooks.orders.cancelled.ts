import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { cancelInvoiceForOrder } from "../services/invoice-builder.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  if (!payload || !payload.id) {
    return new Response("Invalid payload", { status: 400 });
  }

  const outcome = await cancelInvoiceForOrder(shop, String(payload.id));
  return new Response(outcome, { status: 200 });
};
