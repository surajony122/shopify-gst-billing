import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigate, useNavigation, useSearchParams, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  useIndexResourceState,
  Text,
  Badge,
  ButtonGroup,
  Button,
  TextField,
  InlineStack,
  BlockStack,
  Pagination,
  Box,
  Banner,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
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
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync_past_orders") {
    const setting = await prisma.storeSetting.findUnique({ where: { shop } });
    const sellerStateCode = setting?.stateCode || "27";
    let nextSeq = setting?.nextInvoiceNumber || 1;
    const prefix = setting?.invoicePrefix || "INV/{FY}/";
    const financialYear = getCurrentFinancialYear();

    // Query past orders from Shopify Admin GraphQL API
    const response = await admin.graphql(`
      query getPastOrders {
        orders(first: 50, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            name
            createdAt
            email
            phone
            customer {
              firstName
              lastName
              email
              phone
            }
            shippingAddress {
              address1
              city
              province
              zip
            }
            billingAddress {
              address1
              city
              province
              zip
            }
            customAttributes {
              key
              value
            }
            lineItems(first: 50) {
              nodes {
                id
                title
                variantTitle
                sku
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
                product {
                  id
                }
              }
            }
          }
        }
      }
    `);

    const jsonRes = await response.json();
    const orders = jsonRes.data?.orders?.nodes || [];
    let syncedCount = 0;

    for (const order of orders) {
      // Shopify order ID is gid://shopify/Order/123456 -> extract numeric
      const numericOrderId = order.id.replace("gid://shopify/Order/", "");

      // Check if invoice already exists
      const existing = await prisma.invoice.findUnique({
        where: { shopifyOrderId: numericOrderId },
      });
      if (existing) continue;

      // Check B2B GSTIN
      let buyerGstin: string | null = null;
      let buyerTradeName: string | null = null;

      (order.customAttributes || []).forEach((attr: any) => {
        const k = attr.key?.toLowerCase();
        if (["gstin", "gst_number", "gst_in", "tax_id"].includes(k)) {
          buyerGstin = attr.value?.trim().toUpperCase();
        }
        if (["company_name", "business_name", "trade_name"].includes(k)) {
          buyerTradeName = attr.value?.trim();
        }
      });

      // Buyer state code
      let buyerStateCode = buyerGstin ? getStateCodeFromGSTIN(buyerGstin) : null;
      if (!buyerStateCode) {
        const province = order.shippingAddress?.province || order.billingAddress?.province || "Maharashtra";
        buyerStateCode = getStateCodeFromName(province);
      }

      // Line items tax calculation
      const lineItemsInput = (order.lineItems?.nodes || []).map((item: any) => ({
        title: item.title,
        variantTitle: item.variantTitle,
        sku: item.sku,
        hsnCode: "999999",
        quantity: item.quantity,
        unitPrice: parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || "0"),
        discountAmount: 0,
        gstRate: 18.0,
      }));

      const taxResult = calculateOrderGST({
        sellerStateCode,
        buyerStateCode,
        lineItems: lineItemsInput,
        roundOff: setting?.roundOffSection170 ?? true,
      });

      const invoiceNumber = formatInvoiceNumber(prefix, nextSeq);

      await prisma.invoice.create({
        data: {
          shop,
          shopifyOrderId: numericOrderId,
          shopifyOrderNumber: order.name?.replace("#", "") || numericOrderId,
          invoiceNumber,
          financialYear,
          orderDate: new Date(order.createdAt),
          isB2B: Boolean(buyerGstin),
          buyerGstin,
          buyerTradeName: buyerTradeName || (order.customer ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim() : "Retail Customer (B2C)"),
          buyerEmail: order.email || order.customer?.email,
          buyerPhone: order.phone || order.customer?.phone,
          shippingAddress: order.shippingAddress || {},
          billingAddress: order.billingAddress || {},
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
      });

      nextSeq += 1;
      syncedCount += 1;
    }

    // Update sequence
    await prisma.storeSetting.upsert({
      where: { shop },
      update: { nextInvoiceNumber: nextSeq },
      create: { shop, nextInvoiceNumber: nextSeq },
    });

    return json({
      success: true,
      message: syncedCount > 0
        ? `बधाई हो! ${syncedCount} पुराने ऑर्डर्स का पक्का GST बिल सफलतापूर्वक बन गया है!`
        : "सभी पुराने ऑर्डर्स के GST बिल पहले से बने हुए हैं!",
    });
  }

  return json({ success: false });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const search = url.searchParams.get("query") || "";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = 20;

  const whereClause: any = { shop };
  if (search) {
    whereClause.OR = [
      { invoiceNumber: { contains: search, mode: "insensitive" } },
      { shopifyOrderNumber: { contains: search, mode: "insensitive" } },
      { buyerGstin: { contains: search, mode: "insensitive" } },
      { buyerTradeName: { contains: search, mode: "insensitive" } },
    ];
  }

  const [invoices, totalCount] = await Promise.all([
    prisma.invoice.findMany({
      where: whereClause,
      orderBy: { invoiceDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { lineItems: true },
    }),
    prisma.invoice.count({ where: whereClause }),
  ]);

  return json({
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      orderNumber: inv.shopifyOrderNumber,
      date: new Date(inv.invoiceDate).toLocaleDateString("en-IN"),
      customer: inv.buyerTradeName || "Retail Customer",
      isB2B: inv.isB2B,
      buyerGstin: inv.buyerGstin || "N/A",
      placeOfSupply: inv.placeOfSupplyState,
      isInterState: inv.isInterState,
      taxableValue: `₹${inv.subtotalTaxable.toFixed(2)}`,
      totalTax: `₹${(inv.cgstTotal + inv.sgstTotal + inv.igstTotal).toFixed(2)}`,
      grandTotal: `₹${inv.grandTotal.toFixed(2)}`,
      irnStatus: inv.irnStatus || "N/A",
    })),
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit) || 1,
  });
};

export default function InvoicesListPage() {
  const { invoices, totalCount, page, totalPages } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSyncing = navigation.state === "submitting" && navigation.formData?.get("intent") === "sync_past_orders";

  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("query") || "");

  const resourceName = {
    singular: "invoice",
    plural: "invoices",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(invoices);

  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set("query", value);
    } else {
      newParams.delete("query");
    }
    newParams.set("page", "1");
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const handleSyncPastOrders = () => {
    const fd = new FormData();
    fd.append("intent", "sync_past_orders");
    submit(fd, { method: "post" });
  };

  const rowMarkup = invoices.map(
    (
      {
        id,
        invoiceNumber,
        orderNumber,
        date,
        customer,
        isB2B,
        buyerGstin,
        placeOfSupply,
        isInterState,
        taxableValue,
        totalTax,
        grandTotal,
      },
      index
    ) => (
      <IndexTable.Row
        id={id}
        key={id}
        selected={selectedResources.includes(id)}
        position={index}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {invoiceNumber}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>#{orderNumber}</IndexTable.Cell>
        <IndexTable.Cell>{date}</IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" fontWeight="medium">{customer}</Text>
            {isB2B ? (
              <Badge tone="info">B2B: {buyerGstin}</Badge>
            ) : (
              <Text as="span" variant="bodyXs" tone="subdued">B2C (Retail Customer)</Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm">{placeOfSupply}</Text>
            <Badge tone={isInterState ? "attention" : "success"}>
              {isInterState ? "IGST (Other State)" : "CGST + SGST (Same State)"}
            </Badge>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>{taxableValue}</IndexTable.Cell>
        <IndexTable.Cell>{totalTax}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {grandTotal}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <ButtonGroup>
            <Button
              size="micro"
              variant="primary"
              url={`/api/invoices/${id}/pdf`}
              target="_blank"
            >
              पक्का बिल (PDF)
            </Button>
          </ButtonGroup>
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  return (
    <Page
      title="GST Tax Invoices (पक्का बिल)"
      subtitle={`कुल ${totalCount} बिल जारी किए गए (Rule 46 Compliant)`}
      primaryAction={{
        content: isSyncing ? "Syncing Previous Orders..." : "📥 Sync Past Orders (पुराने ऑर्डर्स का बिल बनाएं)",
        onAction: handleSyncPastOrders,
        loading: isSyncing,
      }}
      secondaryActions={[
        {
          content: "Download GSTR-1 for CA (सीए के लिए रिपोर्ट)",
          url: "/app/reports",
        },
      ]}
    >
      <BlockStack gap="400">
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Card padding="300">
          <TextField
            label="Search Invoices"
            labelHidden
            placeholder="Search by Bill No, Order #, Party Name, or GSTIN (बिल नंबर या पार्टी का नाम खोजें)..."
            value={query}
            onChange={handleSearchChange}
            clearButton
            onClearButtonClick={() => handleSearchChange("")}
            autoComplete="off"
          />
        </Card>

        <Card padding="0">
          {invoices.length === 0 ? (
            <Box padding="600">
              <BlockStack gap="300" inlineAlign="center">
                <Text as="p" variant="headingSm" alignment="center">
                  अभी तक कोई बिल नहीं बना है (No Invoices Found)
                </Text>
                <Text as="p" tone="subdued" alignment="center">
                  यदि आपके स्टोर पर पहले से ऑर्डर्स हैं, तो ऊपर दिए गए बटन पर क्लिक करें:
                </Text>
                <Button variant="primary" onClick={handleSyncPastOrders} loading={isSyncing}>
                  📥 Sync Past Orders (पुराने ऑर्डर्स का बिल बनाएं)
                </Button>
              </BlockStack>
            </Box>
          ) : (
            <>
              <IndexTable
                resourceName={resourceName}
                itemCount={invoices.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Bill No. (बिल नंबर)" },
                  { title: "Order #" },
                  { title: "Date (तारीख)" },
                  { title: "Customer / Party (ग्राहक)" },
                  { title: "State & Tax Type (राज्य)" },
                  { title: "Taxable (बिना टैक्स)" },
                  { title: "GST (टैक्स)" },
                  { title: "Total (कुल बिल)" },
                  { title: "Action" },
                ]}
              >
                {rowMarkup}
              </IndexTable>
              <Box padding="400">
                <InlineStack align="center">
                  <Pagination
                    hasPrevious={page > 1}
                    onPrevious={() => {
                      const p = new URLSearchParams(searchParams);
                      p.set("page", String(page - 1));
                      setSearchParams(p);
                    }}
                    hasNext={page < totalPages}
                    onNext={() => {
                      const p = new URLSearchParams(searchParams);
                      p.set("page", String(page + 1));
                      setSearchParams(p);
                    }}
                  />
                </InlineStack>
              </Box>
            </>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
