import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/** Shopify's mandatory privacy webhooks: customers/data_request, customers/redact, shop/redact. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const body = payload as any;
  const normalizedTopic = String(topic).toLowerCase().replace("/", "_");

  if (normalizedTopic === "customers_data_request") {
    // Log IDs only. The merchant answers the request from the invoices in the app.
    console.info(`Customer data request for ${shop}, orders: ${(body.orders_requested || []).join(",")}`);
  }

  if (normalizedTopic === "customers_redact") {
    const orderIds = (body.orders_to_redact || []).map(String);
    const invoices = await prisma.invoice.findMany({
      where: { shop, shopifyOrderId: { in: orderIds } },
      select: { id: true, isB2B: true, placeOfSupplyState: true },
    });

    // Tax law requires the invoice itself to be kept, so only contact details are removed.
    // B2B invoices keep the business name and GSTIN, which the GST return needs.
    for (const invoice of invoices) {
      const addressStub = { province: invoice.placeOfSupplyState };
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          buyerEmail: null,
          buyerPhone: null,
          shippingAddress: addressStub,
          billingAddress: addressStub,
          ...(invoice.isB2B ? {} : { buyerTradeName: "Retail Customer" }),
        },
      });
    }
  }

  if (normalizedTopic === "shop_redact") {
    // Credit notes and line items are removed by cascade.
    await prisma.$transaction([
      prisma.invoice.deleteMany({ where: { shop } }),
      prisma.hsnCatalog.deleteMany({ where: { shop } }),
      prisma.collectionHsn.deleteMany({ where: { shop } }),
      prisma.warehouseGSTIN.deleteMany({ where: { shop } }),
      prisma.storeSetting.deleteMany({ where: { shop } }),
      prisma.session.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response("OK", { status: 200 });
};
