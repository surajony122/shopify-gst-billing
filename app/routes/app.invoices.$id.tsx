import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  ButtonGroup,
  Button,
  Divider,
  DataTable,
  Box,
  InlineGrid,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const invoiceId = params.id;

  if (!invoiceId) {
    throw new Response("Invoice ID required", { status: 400 });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, shop },
    include: { lineItems: true },
  });

  if (!invoice) {
    throw new Response("Invoice not found", { status: 404 });
  }

  return json({
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      orderNumber: invoice.shopifyOrderNumber,
      financialYear: invoice.financialYear,
      date: new Date(invoice.invoiceDate).toLocaleDateString("en-IN"),
      orderDate: new Date(invoice.orderDate).toLocaleDateString("en-IN"),
      isB2B: invoice.isB2B,
      buyerGstin: invoice.buyerGstin || "N/A",
      buyerTradeName: invoice.buyerTradeName || "Retail Customer (B2C)",
      placeOfSupply: `${invoice.placeOfSupplyCode} - ${invoice.placeOfSupplyState}`,
      isInterState: invoice.isInterState,
      subtotalTaxable: `₹${invoice.subtotalTaxable.toFixed(2)}`,
      cgstTotal: `₹${invoice.cgstTotal.toFixed(2)}`,
      sgstTotal: `₹${invoice.sgstTotal.toFixed(2)}`,
      igstTotal: `₹${invoice.igstTotal.toFixed(2)}`,
      roundOffAmount: `₹${invoice.roundOffAmount.toFixed(2)}`,
      grandTotal: `₹${invoice.grandTotal.toFixed(2)}`,
      templateUsed: (invoice as any).templateUsed || "standard_b2b",
      ewayBillRequired: (invoice as any).ewayBillRequired || false,
      lineItems: invoice.lineItems.map((item, idx) => [
        idx + 1,
        item.title,
        item.hsnCode,
        item.quantity,
        `₹${item.unitPrice.toFixed(2)}`,
        `₹${item.taxableValue.toFixed(2)}`,
        `${item.gstRate}%`,
        `₹${(item.cgstAmount + item.sgstAmount + item.igstAmount).toFixed(2)}`,
        `₹${item.totalAmount.toFixed(2)}`,
      ]),
    },
  });
};

export default function SingleInvoiceViewPage() {
  const { invoice } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<string>(invoice.templateUsed || "standard_b2b");

  const pdfUrl = `/api/invoices/${invoice.id}/pdf?template=${template}`;

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = `Invoice-${invoice.invoiceNumber.replace(/\//g, "-")}.pdf`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    const frame = document.getElementById("invoice-detail-pdf-frame") as HTMLIFrameElement;
    frame?.contentWindow?.print();
  };

  return (
    <Page
      backAction={{ content: "Invoices", onAction: () => navigate("/app/invoices") }}
      title={`Invoice ${invoice.invoiceNumber}`}
      subtitle={`Order #${invoice.orderNumber} • Issued on ${invoice.date}`}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone={invoice.isB2B ? "info" : "success"}>
            {invoice.isB2B ? `B2B: ${invoice.buyerGstin}` : "B2C Retail"}
          </Badge>
          {invoice.ewayBillRequired && <Badge tone="critical">e-Way Bill Required</Badge>}
        </InlineStack>
      }
      primaryAction={{
        content: "Download PDF",
        onAction: handleDownload,
      }}
      secondaryActions={[
        {
          content: "Print Invoice",
          onAction: handlePrint,
        },
        {
          content: "Open in New Window",
          onAction: () => window.open(pdfUrl, "_blank"),
        },
      ]}
    >
      <BlockStack gap="500">
        {/* Invoice Summary Card */}
        <Card>
          <BlockStack gap="300">
            <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">Billed To / Customer</Text>
                <Text as="span" fontWeight="bold">{invoice.buyerTradeName}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">Place of Supply</Text>
                <Text as="span" fontWeight="bold">{invoice.placeOfSupply}</Text>
                <Badge tone={invoice.isInterState ? "attention" : "success"}>
                  {invoice.isInterState ? "Inter-State (IGST)" : "Intra-State (CGST+SGST)"}
                </Badge>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">Taxable Subtotal</Text>
                <Text as="span" fontWeight="bold">{invoice.subtotalTaxable}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">Net Grand Total</Text>
                <Text as="span" variant="headingMd" fontWeight="bold">{invoice.grandTotal}</Text>
              </BlockStack>
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Live Interactive PDF Viewer */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">Live Invoice Preview</Text>
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">Template Layout:</Text>
                <ButtonGroup segmented>
                  <Button
                    size="micro"
                    pressed={template === "standard_b2b"}
                    onClick={() => setTemplate("standard_b2b")}
                  >
                    Standard B2B
                  </Button>
                  <Button
                    size="micro"
                    pressed={template === "modern_d2c"}
                    onClick={() => setTemplate("modern_d2c")}
                  >
                    Modern D2C
                  </Button>
                  <Button
                    size="micro"
                    pressed={template === "minimalist"}
                    onClick={() => setTemplate("minimalist")}
                  >
                    Minimalist
                  </Button>
                  <Button
                    size="micro"
                    pressed={template === "thermal_pos"}
                    onClick={() => setTemplate("thermal_pos")}
                  >
                    Thermal POS
                  </Button>
                </ButtonGroup>
              </InlineStack>
            </InlineStack>

            <div style={{ height: "650px", width: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid #dcdfe4" }}>
              <iframe
                id="invoice-detail-pdf-frame"
                key={`${invoice.id}-${template}`}
                src={pdfUrl}
                style={{ width: "100%", height: "100%", border: "none" }}
                title="Invoice Detail Preview"
              />
            </div>
          </BlockStack>
        </Card>

        {/* Line Items Table */}
        <Card padding="0">
          <Box padding="400">
            <Text as="h2" variant="headingSm">Tax Invoice Line Items & Slabs</Text>
          </Box>
          <DataTable
            columnContentTypes={["numeric", "text", "text", "numeric", "numeric", "numeric", "text", "numeric", "numeric"]}
            headings={["#", "Item Description", "HSN/SAC", "Qty", "Rate", "Taxable Value", "GST %", "GST Amount", "Total (INR)"]}
            rows={invoice.lineItems}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}
