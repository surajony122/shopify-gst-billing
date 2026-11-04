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
  const customerName = `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim();
  return {
    id: gidNumber(order.id) as string,
    orderNumber: order.name?.replace("#", "") || (gidNumber(order.id) as string),
    createdAt: order.createdAt,
    taxesIncluded: Boolean(order.taxesIncluded),
    shippingAmount: money(order.shippingLine?.discountedPriceSet?.shopMoney?.amount),
    totalPaid: order.totalPriceSet ? money(order.totalPriceSet.shopMoney?.amount) : undefined,
    province: order.shippingAddress?.province || order.billingAddress?.province,
    customerName: customerName || order.shippingAddress?.name,
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
async function prepareInvoice(shop: string, order: NormalizedOrder) {
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
  order: NormalizedOrder
): Promise<{ created: boolean; invoiceNumber?: string }> {
  const existing = await prisma.invoice.findUnique({ where: { shopifyOrderId: order.id } });
  if (existing) return { created: false, invoiceNumber: existing.invoiceNumber };

  const { fields, rules, usesB2BSeries } = await prepareInvoice(shop, order);

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
  ${withCustomer ? `
  email
  phone
  customer { firstName lastName }
  shippingAddress { name phone address1 address2 city province zip country }
  billingAddress { address1 address2 city province zip country }
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
  now: Date = new Date()
): Promise<RegenerateResult> {
  const invoices = await prisma.invoice.findMany({
    where: { shop },
    include: { _count: { select: { creditNotes: true } } },
    orderBy: { invoiceDate: "asc" },
  });

  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const { start: currentMonthStart } = getReturnPeriodRange(ist.getUTCMonth() + 1, ist.getUTCFullYear());

  const result: RegenerateResult = {
    regenerated: 0,
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

      const { fields } = await prepareInvoice(shop, order);
      await prisma.$transaction([
        prisma.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } }),
        prisma.invoice.update({ where: { id: invoice.id }, data: fields }),
      ]);
      result.regenerated += 1;
    }
  }

  return result;
}
