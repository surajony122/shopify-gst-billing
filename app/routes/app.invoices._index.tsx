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
    try {
      const setting = await prisma.storeSetting.findUnique({ where: { shop } });
      const sellerStateCode = setting?.stateCode || "27";
      let nextSeq = setting?.nextInvoiceNumber || 1;
      let nextB2BSeq = (setting as any)?.nextB2BInvoiceNumber || 1;
      const prefix = setting?.invoicePrefix || "INV/{FY}/";
      const financialYear = getCurrentFinancialYear();

      // Fetch saved HSN catalogs and collection mappings for accurate HSN tagging
      const [hsnCatalogs, collectionHsns] = await Promise.all([
        prisma.hsnCatalog.findMany({ where: { shop } }),
        prisma.collectionHsn.findMany({ where: { shop } }),
      ]);

      // Safe query without Level 2 protected customer data to guarantee success
      const response = await admin.graphql(`
        query getPastOrders {
          orders(first: 50, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              createdAt
              displayFinancialStatus
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
                }
              }
            }
          }
        }
      `);

      const jsonRes = await response.json();

      if (jsonRes.errors && jsonRes.errors.length > 0) {
        return json({
          success: false,
          message: `Shopify GraphQL Error: ${jsonRes.errors[0]?.message || "Could not retrieve orders"}`,
        });
      }

      const orders = jsonRes.data?.orders?.nodes || [];
      let syncedCount = 0;

      for (const order of orders) {
        const numericOrderId = order.id.replace("gid://shopify/Order/", "");

        const existing = await prisma.invoice.findUnique({
          where: { shopifyOrderId: numericOrderId },
        });
        if (existing) continue;

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

        // Determine buyer state code
        let buyerStateCode = buyerGstin ? getStateCodeFromGSTIN(buyerGstin) : null;
        if (!buyerStateCode) {
          buyerStateCode = sellerStateCode; // Default to same state (Intrastate)
        }

        // Process line items with HSN lookup and price-tier tax rules
        const lineItemsInput = (order.lineItems?.nodes || []).map((item: any) => {
          const unitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || "0");
          
          // Match HSN catalog by SKU or title
          const catalogMatch = hsnCatalogs.find((c) => (c.sku && c.sku === item.sku) || c.productTitle === item.title);
          let hsnCode = catalogMatch?.hsnCode || "999999";
          let baseRate = catalogMatch?.gstRate ?? 18.0;

          // Apply statutory Apparel & Footwear ₹1,000 price point rule (5% vs 12%)
          const tierResolution = (setting as any)?.apparelFootwearTierRule ?? true
            ? (hsnCode.startsWith("61") || hsnCode.startsWith("62") || hsnCode.startsWith("64"))
              ? unitPrice <= 1000 ? 5.0 : 12.0
              : baseRate
            : baseRate;

          return {
            title: item.title,
            variantTitle: item.variantTitle,
            sku: item.sku,
            hsnCode,
            quantity: item.quantity,
            unitPrice,
            discountAmount: 0,
            gstRate: tierResolution,
          };
        });

        // Calculate order GST
        const taxResult = calculateOrderGST({
          sellerStateCode,
          buyerStateCode,
          lineItems: lineItemsInput,
          roundOff: setting?.roundOffSection170 ?? true,
        });

        // Evaluate Invoicing Rules (Amount-based, B2B, e-Way Bill, Template)
        const isB2B = Boolean(buyerGstin);
        let selectedTemplate = setting?.invoiceTemplate || "standard_b2b";
        let activePrefix = prefix;
        let invoiceSeq = nextSeq;

        if (isB2B && (setting as any)?.b2bForceTemplate) {
          selectedTemplate = (setting as any)?.b2bForcedTemplate || "standard_b2b";
        } else if ((setting as any)?.amountRulesEnabled) {
          if (taxResult.grandTotal >= ((setting as any)?.highValueThreshold ?? 10000)) {
            selectedTemplate = (setting as any)?.highValueTemplate || "standard_b2b";
          } else if (taxResult.grandTotal <= ((setting as any)?.lowValueThreshold ?? 1000)) {
            selectedTemplate = (setting as any)?.lowValueTemplate || "modern_d2c";
          }
        }

        if (isB2B && (setting as any)?.b2bInvoicePrefix) {
          activePrefix = (setting as any).b2bInvoicePrefix;
          invoiceSeq = nextB2BSeq;
          nextB2BSeq += 1;
        } else {
          nextSeq += 1;
        }

        const ewayBillRequired = taxResult.grandTotal >= ((setting as any)?.ewayBillNoticeThreshold ?? 50000);
        const invoiceNumber = formatInvoiceNumber(activePrefix, invoiceSeq);

        await prisma.invoice.create({
          data: {
            shop,
            shopifyOrderId: numericOrderId,
            shopifyOrderNumber: order.name?.replace("#", "") || numericOrderId,
            invoiceNumber,
            financialYear,
            orderDate: new Date(order.createdAt),
            isB2B,
            buyerGstin,
            buyerTradeName: buyerTradeName || (buyerGstin ? "B2B Business Buyer" : "Retail Customer (B2C)"),
            placeOfSupplyState: taxResult.placeOfSupplyState,
            placeOfSupplyCode: taxResult.buyerStateCode,
            isInterState: taxResult.isInterState,
            subtotalTaxable: taxResult.subtotalTaxable,
            cgstTotal: taxResult.cgstTotal,
            sgstTotal: taxResult.sgstTotal,
            igstTotal: taxResult.igstTotal,
            roundOffAmount: taxResult.roundOffAmount,
            grandTotal: taxResult.grandTotal,
            templateUsed: selectedTemplate,
            ewayBillRequired,
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

        syncedCount += 1;
      }

      await prisma.storeSetting.upsert({
        where: { shop },
        update: {
          nextInvoiceNumber: nextSeq,
          nextB2BInvoiceNumber: nextB2BSeq,
        },
        create: {
          shop,
          nextInvoiceNumber: nextSeq,
          nextB2BInvoiceNumber: nextB2BSeq,
        },
      });

      return json({
        success: true,
        message: syncedCount > 0
          ? `Successfully synced ${syncedCount} orders with dynamic rules & templates!`
          : "All existing orders already have GST invoices generated.",
      });
    } catch (err: any) {
      console.error("Error in sync_past_orders:", err);
      return json({
        success: false,
        message: `Failed to sync orders: ${err.message || "Unknown error"}`,
      });
    }
  }

  return json({ success: false, message: "Invalid action" });
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
      templateUsed: (inv as any).templateUsed || "standard_b2b",
      ewayBillRequired: (inv as any).ewayBillRequired || false,
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
        templateUsed,
        ewayBillRequired,
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
          <BlockStack gap="050">
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {invoiceNumber}
            </Text>
            <InlineStack gap="100">
              <Badge tone="info">{templateUsed === "thermal_pos" ? "Thermal POS" : templateUsed === "modern_d2c" ? "Modern D2C" : templateUsed === "minimalist" ? "Minimalist" : "Standard B2B"}</Badge>
              {ewayBillRequired && <Badge tone="critical">e-Way Bill</Badge>}
            </InlineStack>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>#{orderNumber}</IndexTable.Cell>
        <IndexTable.Cell>{date}</IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" fontWeight="medium">{customer}</Text>
            {isB2B ? (
              <Badge tone="info">B2B: {buyerGstin}</Badge>
            ) : (
              <Text as="span" variant="bodyXs" tone="subdued">B2C</Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm">{placeOfSupply}</Text>
            <Badge tone={isInterState ? "attention" : "success"}>
              {isInterState ? "IGST (Inter-State)" : "CGST + SGST (Same State)"}
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
              PDF
            </Button>
          </ButtonGroup>
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  return (
    <Page
      title="GST Tax Invoices"
      subtitle={`Total ${totalCount} invoices issued (Rule 46 Compliant)`}
      primaryAction={{
        content: isSyncing ? "Syncing Past Orders..." : "Sync Past Orders",
        onAction: handleSyncPastOrders,
        loading: isSyncing,
      }}
      secondaryActions={[
        {
          content: "Export GSTR-1 for CA",
          url: "/app/reports",
        },
      ]}
    >
      <BlockStack gap="400">
        {actionData?.success !== undefined && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Card padding="300">
          <TextField
            label="Search Invoices"
            labelHidden
            placeholder="Search by Invoice #, Order #, Customer, or GSTIN..."
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
                  No invoices generated yet
                </Text>
                <Text as="p" tone="subdued" alignment="center">
                  If your store has existing orders, click below to generate their tax invoices:
                </Text>
                <Button variant="primary" onClick={handleSyncPastOrders} loading={isSyncing}>
                  Sync Past Orders
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
                  { title: "Invoice No." },
                  { title: "Order #" },
                  { title: "Date" },
                  { title: "Recipient / GSTIN" },
                  { title: "Place of Supply" },
                  { title: "Taxable" },
                  { title: "GST" },
                  { title: "Total" },
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
