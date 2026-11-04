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
  cleanStateName,
  validateGSTINFormat,
} from "./gst-engine";
import { getReturnPeriodRange } from "./gstr1-exporter.server";

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
  cancelled?: boolean;
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
    cancelled: Boolean(order.cancelled_at),
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
    cancelled: Boolean(order.cancelledAt),
    shippingAmount: money(order.shippingLine?.discountedPriceSet?.shopMoney?.amount),
    totalPaid: order.totalPriceSet ? money(order.totalPriceSet.shopMoney?.amount) : undefined,
    province: order.shippingAddress?.province || order.billingAddress?.province,
    customerName: order.shippingAddress?.name || order.billingAddress?.name,
    email: order.email,
    phone: order.phone || order.shippingAddress?.phone,
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
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

/** Works out the tax, rules and buyer details for an order without saving anything. */
async function prepareInvoice(shop: string, order: NormalizedOrder, admin?: any) {
  const [setting, catalog, collectionMappings] = await Promise.all([
    prisma.storeSetting.findUnique({ where: { shop } }),
    prisma.hsnCatalog.findMany({ where: { shop } }),
    prisma.collectionHsn.findMany({ where: { shop } }),
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

  const findProductMapping = (line: NormalizedOrderLine) =>
    catalog.find((c) => line.variantId && c.shopifyVariantId === line.variantId) ||
    catalog.find((c) => line.productId && c.shopifyProductId === line.productId) ||
    catalog.find((c) => line.sku && c.sku === line.sku) ||
    catalog.find((c) => c.productTitle === line.title);

  const unmappedProductIds = order.lines
    .filter((line) => line.productId && !findProductMapping(line))
    .map((line) => line.productId as string);
  const productCollections =
    collectionMappings.length > 0 ? await fetchProductCollections(admin, unmappedProductIds) : new Map<string, string[]>();

  // Composition dealers issue a Bill of Supply and cannot collect GST from buyers.
  const isComposition = setting?.taxScheme === "composition";
  const tierRuleEnabled = setting?.apparelFootwearTierRule ?? true;
  const lineItems = order.lines.map((line) => {
    // Priority: product, then collection, then the store-wide default.
    const collectionIds = productCollections.get(line.productId || "") || [];
    const mapping =
      findProductMapping(line) ||
      collectionMappings.find((m) => collectionIds.includes(m.shopifyCollectionId));
    const hsnCode = mapping?.hsnCode || setting?.defaultHsnCode || "999999";
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
      gstRate: isComposition
        ? 0
        : resolveItemGstRate(hsnCode, valuePerPiece, mapping?.gstRate ?? setting?.defaultGstRate ?? 18, tierRuleEnabled).rate,
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
      gstRate: isComposition
        ? 0
        : resolveShippingGstRate(
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

  const fields = {
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
  };

  return { fields, rules, usesB2BSeries };
}

/**
 * Creates the GST invoice for an order. Safe to call repeatedly: an order that
 * already has an invoice is left alone.
 */
export async function createInvoiceForOrder(
  shop: string,
  order: NormalizedOrder,
  admin?: any
): Promise<{ created: boolean; invoiceNumber?: string }> {
  // A cancelled order is not a supply, so it gets no invoice.
  if (order.cancelled) return { created: false };

  const existing = await prisma.invoice.findUnique({ where: { shopifyOrderId: order.id } });
  if (existing) return { created: false, invoiceNumber: existing.invoiceNumber };

  const { fields, rules, usesB2BSeries } = await prepareInvoice(shop, order, admin);

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
          ...fields,
          shop,
          shopifyOrderId: order.id,
          shopifyOrderNumber: order.orderNumber,
          invoiceNumber: number,
          financialYear: getCurrentFinancialYear(),
          orderDate: new Date(order.createdAt),
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

// ---------- Reading orders from Shopify ----------

const orderFields = (withCustomer: boolean) => `
  id
  name
  createdAt
  taxesIncluded
  cancelledAt
  ${withCustomer ? `
  email
  phone
  shippingAddress { name phone address1 address2 city province zip country }
  billingAddress { name address1 address2 city province zip country }
  ` : ""}
  totalPriceSet { shopMoney { amount } }
  shippingLine { discountedPriceSet { shopMoney { amount } } }
  customAttributes { key value }
  lineItems(first: 50) {
    nodes {
      title
      variantTitle
      sku
      quantity
      product { id }
      variant { id }
      originalUnitPriceSet { shopMoney { amount } }
      discountAllocations { allocatedAmountSet { shopMoney { amount } } }
    }
  }
`;

export interface FetchedOrders {
  orders: NormalizedOrder[];
  customerDataAvailable: boolean;
}

/**
 * Customer names and addresses are protected data. Without Shopify's approval the
 * query is rejected, so it is retried without them and the caller is told.
 */
async function queryOrders(
  admin: any,
  buildQuery: (fields: string) => string,
  pickNodes: (data: any) => any[]
): Promise<FetchedOrders> {
  const run = async (withCustomer: boolean) => {
    const response = await admin.graphql(buildQuery(orderFields(withCustomer)));
    const body = (await response.json()) as any;
    if (body.errors?.length) {
      throw new Error(body.errors[0]?.message || "Could not retrieve orders");
    }
    return pickNodes(body.data).filter(Boolean).map(normalizeGraphqlOrder);
  };

  try {
    return { orders: await run(true), customerDataAvailable: true };
  } catch {
    return { orders: await run(false), customerDataAvailable: false };
  }
}

export function fetchRecentOrders(admin: any): Promise<FetchedOrders> {
  return queryOrders(
    admin,
    (fields) => `query { orders(first: 50, sortKey: CREATED_AT, reverse: true) { nodes { ${fields} } } }`,
    (data) => data?.orders?.nodes || []
  );
}

export function fetchOrdersByIds(admin: any, ids: string[]): Promise<FetchedOrders> {
  const gids = ids.map((id) => `"gid://shopify/Order/${id}"`).join(",");
  return queryOrders(
    admin,
    (fields) => `query { nodes(ids: [${gids}]) { ... on Order { ${fields} } } }`,
    (data) => data?.nodes || []
  );
}

/** Returns each product's collection IDs, used to apply collection-level HSN codes. */
async function fetchProductCollections(admin: any, productIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (!admin || productIds.length === 0) return result;

  try {
    const gids = [...new Set(productIds)].map((id) => `"gid://shopify/Product/${id}"`).join(",");
    const response = await admin.graphql(
      `query { nodes(ids: [${gids}]) { ... on Product { id collections(first: 50) { nodes { id } } } } }`
    );
    const body = (await response.json()) as any;
    for (const product of body.data?.nodes || []) {
      if (!product?.id) continue;
      result.set(
        gidNumber(product.id) as string,
        (product.collections?.nodes || []).map((c: any) => gidNumber(c.id))
      );
    }
  } catch (error) {
    console.warn("Could not read product collections, using the store default HSN", error);
  }
  return result;
}

/** Development stores only hold test orders, so their invoices are safe to rebuild freely. */
export async function isDevelopmentStore(admin: any): Promise<boolean> {
  try {
    const response = await admin.graphql(`query { shop { plan { partnerDevelopment } } }`);
    const body = (await response.json()) as any;
    return body.data?.shop?.plan?.partnerDevelopment === true;
  } catch {
    return false;
  }
}

// ---------- Regenerating invoices ----------

export interface RegenerateResult {
  regenerated: number;
  markedCancelled: number;
  skippedCreditNotes: number;
  skippedEarlierMonths: number;
  skippedMissingOrders: number;
  customerDataAvailable: boolean;
}

/**
 * Rebuilds invoices from current Shopify data, keeping each invoice's number and date.
 *
 * Invoices are never rebuilt if they have a credit note, because the note's figures
 * depend on them. On live stores invoices from earlier months are also left alone,
 * because they may already have been sent to customers or filed in a GST return.
 */
export async function regenerateInvoices(
  shop: string,
  fetchOrders: (ids: string[]) => Promise<FetchedOrders>,
  isDevStore: boolean,
  now: Date = new Date(),
  admin?: any
): Promise<RegenerateResult> {
  const invoices = await prisma.invoice.findMany({
    where: { shop, status: "ACTIVE" },
    include: { _count: { select: { creditNotes: true } } },
    orderBy: { invoiceDate: "asc" },
  });

  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const { start: currentMonthStart } = getReturnPeriodRange(ist.getUTCMonth() + 1, ist.getUTCFullYear());

  const result: RegenerateResult = {
    regenerated: 0,
    markedCancelled: 0,
    skippedCreditNotes: 0,
    skippedEarlierMonths: 0,
    skippedMissingOrders: 0,
    customerDataAvailable: true,
  };

  const eligible = invoices.filter((invoice) => {
    if (invoice._count.creditNotes > 0) {
      result.skippedCreditNotes += 1;
      return false;
    }
    if (!isDevStore && invoice.invoiceDate < currentMonthStart) {
      result.skippedEarlierMonths += 1;
      return false;
    }
    return true;
  });

  for (let i = 0; i < eligible.length; i += 50) {
    const batch = eligible.slice(i, i + 50);
    const { orders, customerDataAvailable } = await fetchOrders(batch.map((inv) => inv.shopifyOrderId));
    if (!customerDataAvailable) result.customerDataAvailable = false;
    const ordersById = new Map(orders.map((order) => [order.id, order]));

    for (const invoice of batch) {
      const fetched = ordersById.get(invoice.shopifyOrderId);
      if (!fetched) {
        result.skippedMissingOrders += 1;
        continue;
      }

      if (fetched.cancelled) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: "CANCELLED", cancelledAt: now },
        });
        result.markedCancelled += 1;
        continue;
      }

      // Without customer access, keep what the invoice already knows about the buyer.
      const order: NormalizedOrder = customerDataAvailable
        ? fetched
        : {
            ...fetched,
            province: (invoice.shippingAddress as any)?.province || cleanStateName(invoice.placeOfSupplyState),
            customerName: invoice.buyerTradeName,
            email: invoice.buyerEmail,
            phone: invoice.buyerPhone,
            shippingAddress: invoice.shippingAddress,
            billingAddress: invoice.billingAddress,
          };

      const { fields } = await prepareInvoice(shop, order, admin);
      await prisma.$transaction([
        prisma.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } }),
        prisma.invoice.update({ where: { id: invoice.id }, data: fields }),
      ]);
      result.regenerated += 1;
    }
  }

  return result;
}

// ---------- Credit notes and cancellations ----------

/**
 * Records a credit note, capped at what has not been credited yet so a refund and
 * a cancellation for the same order cannot reverse more than the invoice total.
 */
export async function createCreditNote(
  shop: string,
  invoice: { id: string; grandTotal: number; subtotalTaxable: number; cgstTotal: number; sgstTotal: number; igstTotal: number },
  details: { shopifyRefundId: string; amount: number; reason: string }
): Promise<boolean> {
  const credited = await prisma.creditNote.aggregate({
    where: { invoiceId: invoice.id },
    _sum: { grandTotalAdjusted: true },
  });
  const remaining = invoice.grandTotal - (credited._sum.grandTotalAdjusted || 0);
  const amount = Math.min(details.amount, remaining);
  if (amount < 0.01) return false;

  const ratio = invoice.grandTotal > 0 ? amount / invoice.grandTotal : 0;
  const scaled = (value: number) => Number((value * ratio).toFixed(2));

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
          shopifyRefundId: details.shopifyRefundId,
          creditNoteNumber: formatInvoiceNumber(
            counter.creditNotePrefix || "CN/{FY}/",
            counter.nextCreditNoteNumber - 1
          ),
          financialYear: getCurrentFinancialYear(),
          reason: details.reason,
          taxableAdjusted: scaled(invoice.subtotalTaxable),
          cgstAdjusted: scaled(invoice.cgstTotal),
          sgstAdjusted: scaled(invoice.sgstTotal),
          igstAdjusted: scaled(invoice.igstTotal),
          grandTotalAdjusted: Number(amount.toFixed(2)),
        },
      });
    });
    return true;
  } catch (error: any) {
    if (error?.code === "P2002") return false;
    throw error;
  }
}

export type CancelOutcome = "no_invoice" | "cancelled" | "credit_note" | "nothing_to_do";

/**
 * An invoice from the current month has not reached a GST return yet, so it can simply
 * be cancelled. An earlier month's invoice may already be filed, so it stays on record
 * and a credit note reverses whatever has not been credited.
 */
export async function cancelInvoiceForOrder(shop: string, orderId: string, now: Date = new Date()): Promise<CancelOutcome> {
  const invoice = await prisma.invoice.findFirst({
    where: { shop, shopifyOrderId: orderId },
    include: { _count: { select: { creditNotes: true } } },
  });
  if (!invoice) return "no_invoice";
  if (invoice.status === "CANCELLED") return "nothing_to_do";

  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const { start } = getReturnPeriodRange(ist.getUTCMonth() + 1, ist.getUTCFullYear());

  if (invoice.grandTotal === 0 || (invoice._count.creditNotes === 0 && invoice.invoiceDate >= start)) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED", cancelledAt: now } });
    return "cancelled";
  }

  const created = await createCreditNote(shop, invoice, {
    shopifyRefundId: `cancel-${orderId}`,
    amount: invoice.grandTotal,
    reason: "Order cancelled",
  });
  return created ? "credit_note" : "nothing_to_do";
}
