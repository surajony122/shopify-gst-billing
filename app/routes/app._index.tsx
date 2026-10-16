import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  Text,
  Badge,
  DataTable,
  Button,
  Banner,
  Box,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Retrieve store settings and recent invoices
  const settings = await prisma.storeSetting.findUnique({ where: { shop } });
  const recentInvoices = await prisma.invoice.findMany({
    where: { shop },
    orderBy: { invoiceDate: "desc" },
    take: 5,
  });

  const totalInvoices = await prisma.invoice.count({ where: { shop } });
  const b2bInvoices = await prisma.invoice.count({ where: { shop, isB2B: true } });

  // Calculate aggregates
  const aggregates = await prisma.invoice.aggregate({
    where: { shop },
    _sum: {
      subtotalTaxable: true,
      cgstTotal: true,
      sgstTotal: true,
      igstTotal: true,
      grandTotal: true,
    },
  });

  return json({
    shop,
    hasConfiguredGST: Boolean(settings?.gstin),
    metrics: {
      totalInvoices,
      b2bInvoices,
      taxableValue: aggregates._sum.subtotalTaxable || 0,
      cgstTotal: aggregates._sum.cgstTotal || 0,
      sgstTotal: aggregates._sum.sgstTotal || 0,
      igstTotal: aggregates._sum.igstTotal || 0,
      totalTax: (aggregates._sum.cgstTotal || 0) + (aggregates._sum.sgstTotal || 0) + (aggregates._sum.igstTotal || 0),
      grandTotal: aggregates._sum.grandTotal || 0,
    },
    recentInvoices: recentInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      orderNumber: inv.shopifyOrderNumber,
      date: new Date(inv.invoiceDate).toLocaleDateString("en-IN"),
      customer: inv.buyerTradeName || "Retail Customer",
      isB2B: inv.isB2B,
      amount: `₹${inv.grandTotal.toFixed(2)}`,
      irnStatus: inv.irnStatus || "N/A",
    })),
  });
};

export default function DashboardPage() {
  const { hasConfiguredGST, metrics, recentInvoices } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const invoiceRows = recentInvoices.map((inv) => [
    <Text as="span" fontWeight="bold">{inv.invoiceNumber}</Text>,
    `#${inv.orderNumber}`,
    inv.date,
    inv.customer,
    inv.isB2B ? <Badge tone="info">B2B (GSTIN)</Badge> : <Badge tone="subdued">B2C</Badge>,
    inv.amount,
    <Button size="micro" onClick={() => navigate(`/app/invoices/${inv.id}`)}>View</Button>,
  ]);

  return (
    <Page
      title="GST Billing Dashboard (जीएसटी बिलिंग डैशबोर्ड)"
      subtitle="भारत सरकार के Rule 46 के अनुसार वैध टैक्स बिल, e-Invoice और GSTR-1 रिपोर्ट"
      primaryAction={{
        content: "📥 Sync Past Orders (पुराने ऑर्डर्स का बिल बनाएं)",
        onAction: () => navigate("/app/invoices"),
      }}
      secondaryActions={[
        {
          content: "⚙️ GST Settings (जीएसटी प्रोफाइल)",
          onAction: () => navigate("/app/settings"),
        },
      ]}
    >
      <BlockStack gap="500">
        {!hasConfiguredGST && (
          <Banner
            title="GST Setup Incomplete (जीएसटी नंबर दर्ज नहीं है)"
            tone="warning"
            action={{ content: "Enter GSTIN & Trade Name (जीएसटी नंबर डालें)", onAction: () => navigate("/app/settings") }}
          >
            <p>वैध GST बिल (Rule 46 Tax Invoice) बनाने के लिए कृपया अपना 15 अंकों का GSTIN और कंपनी का नाम दर्ज करें।</p>
          </Banner>
        )}

        {/* KPI Metrics */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">कुल बिल जारी (Total Bills)</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{metrics.totalInvoices}</Text>
              <Text as="p" variant="bodyXs" tone="subdued">{metrics.b2bInvoices} B2B फर्म के बिल</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">बिना टैक्स की बिक्री (Net Sales)</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">₹{metrics.taxableValue.toLocaleString("en-IN")}</Text>
              <Text as="p" variant="bodyXs" tone="success">टैक्स छोड़कर कुल बिक्री</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">GST टैक्स एकत्र (Output Tax)</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">₹{metrics.totalTax.toLocaleString("en-IN")}</Text>
              <Text as="p" variant="bodyXs" tone="subdued">CGST: ₹{metrics.cgstTotal.toFixed(0)} | SGST: ₹{metrics.sgstTotal.toFixed(0)} | IGST: ₹{metrics.igstTotal.toFixed(0)}</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">कुल आमदनी (Gross Sales)</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">₹{metrics.grandTotal.toLocaleString("en-IN")}</Text>
              <Text as="p" variant="bodyXs" tone="success">टैक्स सहित कुल रकम</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Recent Invoices Table */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineGrid columns="1fr auto">
                  <Text as="h2" variant="headingMd">Recent Invoices</Text>
                  <Button variant="plain" onClick={() => navigate("/app/invoices")}>View All Invoices</Button>
                </InlineGrid>
                <Divider />
                {recentInvoices.length === 0 ? (
                  <Box padding="600">
                    <Text as="p" alignment="center" tone="subdued">
                      No invoices generated yet. Invoices will automatically appear when orders are fulfilled or created.
                    </Text>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text", "numeric", "text"]}
                    headings={["Invoice No.", "Order", "Date", "Customer / Buyer", "Type", "Amount", "Action"]}
                    rows={invoiceRows}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
