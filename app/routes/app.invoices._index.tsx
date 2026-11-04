import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useActionData, useLoaderData, useNavigate, useNavigation, useSearchParams, useSubmit } from "@remix-run/react";
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
  Modal,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { InvoiceHTMLPreview } from "../components/InvoiceHTMLPreview";
import { cleanStateName } from "../services/gst-engine";
import {
  createInvoiceForOrder,
  fetchOrdersByIds,
  fetchRecentOrders,
  isDevelopmentStore,
  regenerateInvoices,
} from "../services/invoice-builder.server";
import { downloadSecureFile, openSecureFile } from "../utils/secure-file";

const CUSTOMER_DATA_WARNING =
  "Shopify did not allow access to customer names and addresses, so orders without a GSTIN may show a generic name and your own state as the place of supply. Request protected customer data access in the Partner dashboard, then regenerate.";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync_past_orders") {
    try {
      const { orders, customerDataAvailable } = await fetchRecentOrders(admin);

      let syncedCount = 0;
      for (const order of orders) {
        const result = await createInvoiceForOrder(shop, order, admin);
        if (result.created) syncedCount += 1;
      }

      const summary = syncedCount > 0
        ? `Successfully synced ${syncedCount} orders with dynamic rules & templates!`
        : "All existing orders already have GST invoices generated.";

      return json({
        success: true,
        message: customerDataAvailable || syncedCount === 0
          ? summary
          : `${summary} ${CUSTOMER_DATA_WARNING}`,
      });
    } catch (err: any) {
      console.error("Error in sync_past_orders:", err);
      return json({
        success: false,
        message: `Failed to sync orders: ${err.message || "Unknown error"}`,
      });
    }
  }

  if (intent === "regenerate_invoices") {
    try {
      const result = await regenerateInvoices(
        shop,
        (ids) => fetchOrdersByIds(admin, ids),
        await isDevelopmentStore(admin),
        new Date(),
        admin
      );

      const notes = [
        `Regenerated ${result.regenerated} invoices from current Shopify data.`,
        result.markedCancelled > 0 && `Marked ${result.markedCancelled} as cancelled because their orders were cancelled.`,
        result.skippedCreditNotes > 0 && `Skipped ${result.skippedCreditNotes} with credit notes.`,
        result.skippedEarlierMonths > 0 && `Skipped ${result.skippedEarlierMonths} from earlier months, which may already be sent or filed.`,
        result.skippedMissingOrders > 0 && `Skipped ${result.skippedMissingOrders} whose orders no longer exist in Shopify.`,
        !result.customerDataAvailable && CUSTOMER_DATA_WARNING,
      ].filter(Boolean);

      return json({ success: true, message: notes.join(" ") });
    } catch (err: any) {
      console.error("Error in regenerate_invoices:", err);
      return json({
        success: false,
        message: `Failed to regenerate invoices: ${err.message || "Unknown error"}`,
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

  const [invoices, totalCount, sellerSetting] = await Promise.all([
    prisma.invoice.findMany({
      where: whereClause,
      orderBy: { invoiceDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { lineItems: true },
    }),
    prisma.invoice.count({ where: whereClause }),
    prisma.storeSetting.findUnique({ where: { shop } }),
  ]);

  return json({
    seller: sellerSetting || {
      legalName: "Merchant Store",
      tradeName: "Store",
      gstin: "N/A",
      state: "Maharashtra",
      stateCode: "27",
      brandColor: "#212B36",
      taxScheme: "regular",
    },
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      orderNumber: inv.shopifyOrderNumber,
      financialYear: inv.financialYear,
      date: new Date(inv.invoiceDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
      orderDate: new Date(inv.orderDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
      buyerEmail: inv.buyerEmail,
      buyerPhone: inv.buyerPhone,
      status: inv.status,
      customer: inv.buyerTradeName || "Retail Customer",
      isB2B: inv.isB2B,
      buyerGstin: inv.buyerGstin || "N/A",
      placeOfSupplyState: cleanStateName(inv.placeOfSupplyState),
      placeOfSupplyCode: inv.placeOfSupplyCode,
      placeOfSupply: `${inv.placeOfSupplyCode} - ${cleanStateName(inv.placeOfSupplyState)}`,
      isInterState: inv.isInterState,
      subtotalTaxable: inv.subtotalTaxable,
      cgstTotal: inv.cgstTotal,
      sgstTotal: inv.sgstTotal,
      igstTotal: inv.igstTotal,
      roundOffAmount: inv.roundOffAmount,
      grandTotal: inv.grandTotal,
      taxableValueFormatted: `₹${inv.subtotalTaxable.toFixed(2)}`,
      totalTaxFormatted: `₹${(inv.cgstTotal + inv.sgstTotal + inv.igstTotal).toFixed(2)}`,
      grandTotalFormatted: `₹${inv.grandTotal.toFixed(2)}`,
      irnStatus: inv.irnStatus || "N/A",
      templateUsed: (inv as any).templateUsed || "standard_b2b",
      ewayBillRequired: (inv as any).ewayBillRequired || false,
      lineItems: inv.lineItems.map((li) => ({
        id: li.id,
        title: li.title,
        variantTitle: li.variantTitle,
        sku: li.sku,
        hsnCode: li.hsnCode,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discountAmount: li.discountAmount,
        taxableValue: li.taxableValue,
        gstRate: li.gstRate,
        cgstAmount: li.cgstAmount,
        sgstAmount: li.sgstAmount,
        igstAmount: li.igstAmount,
        totalAmount: li.totalAmount,
      })),
    })),
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit) || 1,
  });
};

export default function InvoicesListPage() {
  const { invoices, seller, totalCount, page, totalPages } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSyncing = navigation.state === "submitting" && navigation.formData?.get("intent") === "sync_past_orders";

  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("query") || "");
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [previewTemplate, setPreviewTemplate] = useState<string>("standard_b2b");
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const isRegenerating = navigation.state === "submitting" && navigation.formData?.get("intent") === "regenerate_invoices";

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

  const handleRegenerate = () => {
    setConfirmRegenerate(false);
    const fd = new FormData();
    fd.append("intent", "regenerate_invoices");
    submit(fd, { method: "post" });
  };

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
        orderDate,
        customer,
        buyerEmail,
        buyerPhone,
        isB2B,
        buyerGstin,
        placeOfSupply,
        isInterState,
        taxableValueFormatted,
        totalTaxFormatted,
        grandTotalFormatted,
        ewayBillRequired,
        status,
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
            <Link to={`/app/invoices/${id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <Text variant="bodyMd" fontWeight="bold" as="span">
                {`Order #${orderNumber}`}
              </Text>
            </Link>
            <Text as="span" variant="bodySm" tone="subdued">{invoiceNumber}</Text>
            {status === "CANCELLED" && <Badge tone="critical">Cancelled</Badge>}
            {status !== "CANCELLED" && ewayBillRequired && <Badge tone="warning">e-Way Bill</Badge>}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm">{orderDate}</Text>
            <Text as="span" variant="bodySm" tone="subdued">{`Invoice: ${date}`}</Text>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" fontWeight="medium">{customer}</Text>
            {buyerEmail && <Text as="span" variant="bodySm" tone="subdued">{buyerEmail}</Text>}
            {buyerPhone && <Text as="span" variant="bodySm" tone="subdued">{buyerPhone}</Text>}
            {isB2B ? (
              <Badge tone="info">{`B2B: ${buyerGstin}`}</Badge>
            ) : (
              <Text as="span" variant="bodySm" tone="subdued">B2C</Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm">{placeOfSupply}</Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {isInterState ? "IGST" : "CGST + SGST"}
            </Text>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>{taxableValueFormatted}</IndexTable.Cell>
        <IndexTable.Cell>{totalTaxFormatted}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {grandTotalFormatted}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <ButtonGroup>
            <Button
              size="micro"
              variant="primary"
              onClick={() => {
                setSelectedInvoice(invoices[index]);
                setPreviewTemplate(invoices[index].templateUsed || "standard_b2b");
              }}
            >
              View
            </Button>
          </ButtonGroup>
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  return (
    <Page
      fullWidth
      title="GST Tax Invoices"
      subtitle={`Total ${totalCount} invoices issued (Rule 46 Compliant)`}
      primaryAction={{
        content: isSyncing ? "Syncing Past Orders..." : "Sync Past Orders",
        onAction: handleSyncPastOrders,
        loading: isSyncing,
      }}
      secondaryActions={[
        {
          content: isRegenerating ? "Regenerating..." : "Regenerate Invoices",
          onAction: () => setConfirmRegenerate(true),
          loading: isRegenerating,
        },
        {
          content: "Export GSTR-1 for CA",
          url: "/app/reports",
        },
      ]}
    >
      <Modal
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        title="Regenerate invoices from Shopify?"
        primaryAction={{ content: "Regenerate", destructive: true, onAction: handleRegenerate }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmRegenerate(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              This replaces the amounts, tax and customer details on existing invoices using current
              Shopify data. Invoice numbers and dates stay the same. This cannot be undone.
            </Text>
            <Text as="p">
              Invoices with credit notes are skipped. On live stores, invoices from earlier months are
              also skipped because they may already be sent to customers or filed.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
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
                selectable={false}
                headings={[
                  { title: "Order / Invoice" },
                  { title: "Order Date" },
                  { title: "Customer" },
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

        {/* Live Invoice Viewer Modal */}
        {selectedInvoice && (
          <Modal
            size="large"
            open={Boolean(selectedInvoice)}
            onClose={() => setSelectedInvoice(null)}
            title={`Tax Invoice: ${selectedInvoice.invoiceNumber} (Order #${selectedInvoice.orderNumber})`}
            primaryAction={{
              content: "Download PDF",
              onAction: () => {
                downloadSecureFile(
                  `/api/invoices/${selectedInvoice.id}/pdf?template=${previewTemplate}`,
                  `Invoice-${selectedInvoice.invoiceNumber.replace(/\//g, "-")}.pdf`
                ).catch((error) => window.alert(error.message));
              },
            }}
            secondaryActions={[
              {
                content: "Print Invoice",
                onAction: () => {
                  const printArea = document.getElementById("invoice-printable-area");
                  if (!printArea) return;
                  const printWin = window.open("", "_blank");
                  if (!printWin) return;
                  printWin.document.write(`
                    <!DOCTYPE html>
                    <html>
                      <head>
                        <title>Invoice ${selectedInvoice.invoiceNumber}</title>
                        <style>
                          body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
                          @media print { body { padding: 0; } }
                        </style>
                      </head>
                      <body>
                        ${printArea.outerHTML}
                      </body>
                    </html>
                  `);
                  printWin.document.close();
                  printWin.focus();
                  setTimeout(() => {
                    printWin.print();
                    printWin.close();
                  }, 300);
                },
              },
              {
                content: "Open PDF in New Window",
                onAction: () => {
                  openSecureFile(`/api/invoices/${selectedInvoice.id}/pdf?template=${previewTemplate}`).catch((error) => window.alert(error.message));
                },
              },
            ]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodySm">
                    Recipient: <strong>{selectedInvoice.customer}</strong> | Place of Supply: <strong>{selectedInvoice.placeOfSupply}</strong> | Total: <strong>{selectedInvoice.grandTotalFormatted}</strong>
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">Switch Design Template:</Text>
                    <ButtonGroup variant="segmented">
                      <Button
                        size="micro"
                        pressed={previewTemplate === "standard_b2b"}
                        onClick={() => setPreviewTemplate("standard_b2b")}
                      >
                        Standard B2B
                      </Button>
                      <Button
                        size="micro"
                        pressed={previewTemplate === "modern_d2c"}
                        onClick={() => setPreviewTemplate("modern_d2c")}
                      >
                        Modern D2C
                      </Button>
                      <Button
                        size="micro"
                        pressed={previewTemplate === "minimalist"}
                        onClick={() => setPreviewTemplate("minimalist")}
                      >
                        Minimalist
                      </Button>
                      <Button
                        size="micro"
                        pressed={previewTemplate === "thermal_pos"}
                        onClick={() => setPreviewTemplate("thermal_pos")}
                      >
                        Thermal POS
                      </Button>
                    </ButtonGroup>
                  </InlineStack>
                </InlineStack>

                <div
                  style={{
                    maxHeight: "640px",
                    overflowY: "auto",
                    borderRadius: "8px",
                    border: "1px solid #dcdfe4",
                    background: "#f1f2f4",
                  }}
                >
                  <InvoiceHTMLPreview
                    invoice={selectedInvoice}
                    seller={seller}
                    template={previewTemplate}
                  />
                </div>
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}
      </BlockStack>
    </Page>
  );
}
