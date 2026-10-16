import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  calculateOrderGST,
  formatInvoiceNumber,
  getCurrentFinancialYear,
  getStateCodeFromName,
  getStateCodeFromGSTIN,
} from "../services/gst-engine";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  if (!payload || !payload.id) {
    return new Response("Invalid payload", { status: 400 });
  }

  const order = payload as any;
  const orderId = String(order.id);

  // Check if invoice already exists
  const existing = await prisma.invoice.findUnique({
    where: { shopifyOrderId: orderId },
  });
  if (existing) {
    return new Response("Invoice already exists", { status: 200 });
  }

  const setting = await prisma.storeSetting.findUnique({ where: { shop } });
  const sellerStateCode = setting?.stateCode || "27";

  // Check for B2B GSTIN in note_attributes / custom_attributes
  let buyerGstin: string | null = null;
  let buyerTradeName: string | null = null;

  if (Array.isArray(order.note_attributes)) {
    const gstinAttr = order.note_attributes.find((a: any) =>
      ["gstin", "gst_number", "gst_in", "tax_id"].includes(a.name?.toLowerCase())
    );
    if (gstinAttr?.value) {
      buyerGstin = gstinAttr.value.trim().toUpperCase();
    }

    const tradeAttr = order.note_attributes.find((a: any) =>
      ["company_name", "business_name", "trade_name"].includes(a.name?.toLowerCase())
    );
    if (tradeAttr?.value) {
      buyerTradeName = tradeAttr.value.trim();
    }
  }

  // Determine Buyer State Code
  let buyerStateCode = buyerGstin ? getStateCodeFromGSTIN(buyerGstin) : null;
  if (!buyerStateCode) {
    const shippingProvince = order.shipping_address?.province || order.billing_address?.province || "Maharashtra";
    buyerStateCode = getStateCodeFromName(shippingProvince);
  }

  // Fetch product HSN mappings
  const lineItemsTaxInput = await Promise.all(
    (order.line_items || []).map(async (item: any) => {
      const hsnRecord = await prisma.hsnCatalog.findFirst({
        where: {
          shop,
          OR: [
            { shopifyProductId: String(item.product_id) },
            { sku: item.sku || undefined },
          ],
        },
      });

      return {
        title: item.title,
        variantTitle: item.variant_title,
        sku: item.sku,
        hsnCode: hsnRecord?.hsnCode || "999999",
        quantity: item.quantity,
        unitPrice: parseFloat(item.price),
        discountAmount: parseFloat(item.total_discount || "0"),
        gstRate: hsnRecord?.gstRate || 18.0,
      };
    })
  );

  const taxResult = calculateOrderGST({
    sellerStateCode,
    buyerStateCode,
    lineItems: lineItemsTaxInput,
    roundOff: setting?.roundOffSection170 ?? true,
  });

  const nextSeq = setting?.nextInvoiceNumber || 1;
  const prefix = setting?.invoicePrefix || "INV/{FY}/";
  const invoiceNumber = formatInvoiceNumber(prefix, nextSeq);
  const financialYear = getCurrentFinancialYear();

  // Create Invoice and Line Items inside a transaction
  await prisma.$transaction([
    prisma.invoice.create({
      data: {
        shop,
        shopifyOrderId: orderId,
        shopifyOrderNumber: String(order.order_number || order.name?.replace("#", "")),
        invoiceNumber,
        financialYear,
        orderDate: new Date(order.created_at || Date.now()),
        isB2B: Boolean(buyerGstin),
        buyerGstin,
        buyerTradeName: buyerTradeName || order.customer?.first_name ? `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() : "Retail Customer",
        buyerEmail: order.email || order.customer?.email,
        buyerPhone: order.phone || order.customer?.phone,
        shippingAddress: order.shipping_address || {},
        billingAddress: order.billing_address || {},
        placeOfSupplyState: taxResult.placeOfSupplyState,
        placeOfSupplyCode: taxResult.buyerStateCode,
        isInterState: taxResult.isInterState,
        subtotalTaxable: taxResult.subtotalTaxable,
        cgstTotal: taxResult.cgstTotal,
        sgstTotal: taxResult.sgstTotal,
        igstTotal: taxResult.igstTotal,
        roundOffAmount: taxResult.roundOffAmount,
        grandTotal: taxResult.grandTotal,
        lineItems: {
          create: taxResult.lineItems.map((li) => ({
            title: li.title,
            variantTitle: li.variantTitle,
            sku: li.sku,
            hsnCode: li.hsnCode,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountAmount: li.discountAmount,
            taxableValue: li.taxableValue,
            gstRate: li.gstRate,
            cgstRate: li.cgstRate,
            cgstAmount: li.cgstAmount,
            sgstRate: li.sgstRate,
            sgstAmount: li.sgstAmount,
            igstRate: li.igstRate,
            igstAmount: li.igstAmount,
            totalAmount: li.totalAmount,
          })),
        },
      },
    }),
    prisma.storeSetting.upsert({
      where: { shop },
      update: { nextInvoiceNumber: nextSeq + 1 },
      create: { shop, nextInvoiceNumber: nextSeq + 1 },
    }),
  ]);

  return new Response("Invoice generated", { status: 200 });
};
