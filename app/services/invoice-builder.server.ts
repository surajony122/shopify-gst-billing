import prisma from "../db.server";
import {
  calculateOrderGST,
  evaluateInvoiceRules,
  formatInvoiceNumber,
  getCurrentFinancialYear,
  getStateCodeFromGSTIN,
  getStateCodeFromName,
  resolveItemGstRate,
  resolveShippingGstRate,
  validateGSTINFormat,
} from "./gst-engine";

const SHIPPING_SAC = "996812";
const GSTIN_KEYS = ["gstin", "gst_number", "gst_in", "tax_id"];
const COMPANY_KEYS = ["company_name", "business_name", "trade_name"];

export interface NormalizedOrderLine {
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  productId?: string | null;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface NormalizedOrder {
  id: string;
  orderNumber: string;
  createdAt: string;
  taxesIncluded: boolean;
  shippingAmount: number;
  totalPaid?: number;
  province?: string | null;
  attributes: Array<{ name?: string; value?: string }>;
  customerName?: string | null;
  email?: string | null;
  phone?: string | null;
  shippingAddress?: any;
  billingAddress?: any;
  lines: NormalizedOrderLine[];
}

const money = (value: unknown) => parseFloat(String(value ?? "0")) || 0;

/** Discount allocations include order-level coupons; total_discount does not. */
function webhookLineDiscount(item: any): number {
  if (Array.isArray(item.discount_allocations) && item.discount_allocations.length > 0) {
    return item.discount_allocations.reduce((sum: number, d: any) => sum + money(d.amount), 0);
  }
  return money(item.total_discount);
}

export function normalizeWebhookOrder(order: any): NormalizedOrder {
  const customerName = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim();
  return {
    id: String(order.id),
    orderNumber: String(order.order_number || order.name?.replace("#", "") || order.id),
    createdAt: order.created_at || new Date().toISOString(),
    taxesIncluded: Boolean(order.taxes_included),
    shippingAmount: (order.shipping_lines || []).reduce(
      (sum: number, line: any) => sum + money(line.discounted_price ?? line.price),
      0
    ),
    totalPaid: order.total_price === undefined ? undefined : money(order.total_price),
    province: order.shipping_address?.province || order.billing_address?.province,
    attributes: order.note_attributes || [],
    customerName,
    email: order.email || order.customer?.email,
    phone: order.phone || order.customer?.phone,
    shippingAddress: order.shipping_address || {},
    billingAddress: order.billing_address || {},
    lines: (order.line_items || []).map((item: any) => ({
      title: item.title,
      variantTitle: item.variant_title,
      sku: item.sku,
      productId: item.product_id ? String(item.product_id) : null,
      variantId: item.variant_id ? String(item.variant_id) : null,
      quantity: item.quantity,
      unitPrice: money(item.price),
      discount: webhookLineDiscount(item),
    })),
  };
}

const gidNumber = (gid?: string | null) => gid?.split("/").pop() || null;

export function normalizeGraphqlOrder(order: any): NormalizedOrder {
  return {
    id: gidNumber(order.id) as string,
    orderNumber: order.name?.replace("#", "") || (gidNumber(order.id) as string),
    createdAt: order.createdAt,
    taxesIncluded: Boolean(order.taxesIncluded),
    shippingAmount: money(order.shippingLine?.discountedPriceSet?.shopMoney?.amount),
    totalPaid: order.totalPriceSet ? money(order.totalPriceSet.shopMoney?.amount) : undefined,
    province: order.shippingAddress?.province,
    attributes: (order.customAttributes || []).map((a: any) => ({ name: a.key, value: a.value })),
    lines: (order.lineItems?.nodes || []).map((item: any) => ({
      title: item.title,
      variantTitle: item.variantTitle,
      sku: item.sku,
      productId: gidNumber(item.product?.id),
      variantId: gidNumber(item.variant?.id),
      quantity: item.quantity,
      unitPrice: money(item.originalUnitPriceSet?.shopMoney?.amount),
      discount: (item.discountAllocations || []).reduce(
        (sum: number, d: any) => sum + money(d.allocatedAmountSet?.shopMoney?.amount),
        0
      ),
    })),
  };
}

function findAttribute(order: NormalizedOrder, keys: string[]): string | null {
  const match = order.attributes.find((a) => keys.includes(a.name?.toLowerCase() || ""));
  return match?.value?.trim() || null;
}

/**
 * Creates the GST invoice for an order. Safe to call repeatedly: an order that
 * already has an invoice is left alone.
 */
export async function createInvoiceForOrder(
  shop: string,
  order: NormalizedOrder
): Promise<{ created: boolean; invoiceNumber?: string }> {
  const existing = await prisma.invoice.findUnique({ where: { shopifyOrderId: order.id } });
  if (existing) return { created: false, invoiceNumber: existing.invoiceNumber };

  const [setting, catalog] = await Promise.all([
    prisma.storeSetting.findUnique({ where: { shop } }),
    prisma.hsnCatalog.findMany({ where: { shop } }),
  ]);
  const sellerStateCode = setting?.stateCode || "27";

  let buyerGstin = findAttribute(order, GSTIN_KEYS)?.toUpperCase() || null;
  if (buyerGstin && (setting?.b2bStrictValidation ?? true) && !validateGSTINFormat(buyerGstin)) {
    console.warn(`Order ${order.id}: ignoring invalid GSTIN, invoicing as B2C`);
    buyerGstin = null;
  }

  const buyerStateCode =
    (buyerGstin && getStateCodeFromGSTIN(buyerGstin)) ||
    (order.province ? getStateCodeFromName(order.province, sellerStateCode) : sellerStateCode);

  const tierRuleEnabled = setting?.apparelFootwearTierRule ?? true;
  const lineItems = order.lines.map((line) => {
    const mapping =
      catalog.find((c) => line.variantId && c.shopifyVariantId === line.variantId) ||
      catalog.find((c) => line.productId && c.shopifyProductId === line.productId) ||
      catalog.find((c) => line.sku && c.sku === line.sku) ||
      catalog.find((c) => c.productTitle === line.title);
    const hsnCode = mapping?.hsnCode || "999999";
    const salePerPiece = line.unitPrice - line.discount / Math.max(1, line.quantity);
    // The apparel threshold applies to the value before GST. 5% is the rate at the threshold.
    const valuePerPiece = order.taxesIncluded ? salePerPiece / 1.05 : salePerPiece;
    return {
      title: line.title,
      variantTitle: line.variantTitle || undefined,
      sku: line.sku || undefined,
      hsnCode,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discount,
      gstRate: resolveItemGstRate(hsnCode, valuePerPiece, mapping?.gstRate ?? 18, tierRuleEnabled).rate,
    };
  });

  if (order.shippingAmount > 0) {
    lineItems.push({
      title: "Shipping Charges",
      variantTitle: undefined,
      sku: undefined,
      hsnCode: SHIPPING_SAC,
      quantity: 1,
      unitPrice: order.shippingAmount,
      discountAmount: 0,
      gstRate: resolveShippingGstRate(
        setting?.shippingTaxMode,
        lineItems.map((item) => item.gstRate),
        setting?.shippingGstRate
      ),
    });
  }

  const tax = calculateOrderGST({
    sellerStateCode,
    buyerStateCode,
    lineItems,
    roundOff: setting?.roundOffSection170 ?? true,
    pricesIncludeTax: order.taxesIncluded,
  });

  if (order.totalPaid !== undefined && Math.abs(order.totalPaid - tax.grandTotal) > 1) {
    console.warn(`Order ${order.id}: invoice total ${tax.grandTotal} differs from order total ${order.totalPaid}`);
  }

  const rules = evaluateInvoiceRules(
    { totalAmount: tax.grandTotal, buyerGstin },
    {
      invoicePrefix: setting?.invoicePrefix || "INV/{FY}/",
      nextInvoiceNumber: setting?.nextInvoiceNumber || 1,
      b2bInvoicePrefix: setting?.b2bInvoicePrefix,
      b2bForceTemplate: setting?.b2bForceTemplate,
      b2bForcedTemplate: setting?.b2bForcedTemplate,
      defaultTemplate: setting?.invoiceTemplate,
      amountRulesEnabled: setting?.amountRulesEnabled,
      highValueThreshold: setting?.highValueThreshold,
      highValueTemplate: setting?.highValueTemplate,
      lowValueThreshold: setting?.lowValueThreshold,
      lowValueTemplate: setting?.lowValueTemplate,
      ewayBillNoticeThreshold: setting?.ewayBillNoticeThreshold,
    }
  );
  const usesB2BSeries = rules.isB2B && Boolean(setting?.b2bInvoicePrefix?.trim());

  try {
    const invoiceNumber = await prisma.$transaction(async (tx) => {
      // Increment inside the transaction so simultaneous webhooks get different numbers.
      const counter = await tx.storeSetting.upsert({
        where: { shop },
        update: usesB2BSeries
          ? { nextB2BInvoiceNumber: { increment: 1 } }
          : { nextInvoiceNumber: { increment: 1 } },
        create: { shop, nextInvoiceNumber: 2 },
      });
      const sequence = (usesB2BSeries ? counter.nextB2BInvoiceNumber : counter.nextInvoiceNumber) - 1;
      const number = formatInvoiceNumber(rules.invoicePrefix, sequence);

      await tx.invoice.create({
        data: {
          shop,
          shopifyOrderId: order.id,
          shopifyOrderNumber: order.orderNumber,
          invoiceNumber: number,
          financialYear: getCurrentFinancialYear(),
          orderDate: new Date(order.createdAt),
          isB2B: Boolean(buyerGstin),
          buyerGstin,
          buyerTradeName:
            findAttribute(order, COMPANY_KEYS) ||
            order.customerName ||
            (buyerGstin ? "B2B Business Buyer" : "Retail Customer"),
          buyerEmail: order.email,
          buyerPhone: order.phone,
          shippingAddress: order.shippingAddress ?? {},
          billingAddress: order.billingAddress ?? {},
          placeOfSupplyState: tax.placeOfSupplyState,
          placeOfSupplyCode: tax.buyerStateCode,
          isInterState: tax.isInterState,
          subtotalTaxable: tax.subtotalTaxable,
          cgstTotal: tax.cgstTotal,
          sgstTotal: tax.sgstTotal,
          igstTotal: tax.igstTotal,
          roundOffAmount: tax.roundOffAmount,
          grandTotal: tax.grandTotal,
          templateUsed: rules.selectedTemplate,
          ewayBillRequired: rules.ewayBillRequired,
          lineItems: {
            create: tax.lineItems.map((li) => ({
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
      });
      return number;
    });
    return { created: true, invoiceNumber };
  } catch (error: any) {
    // Shopify can deliver the same order twice at once; the unique order ID stops the second.
    if (error?.code === "P2002") return { created: false };
    throw error;
  }
}
