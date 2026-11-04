import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineGrid,
  Text,
  Button,
  Banner,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { InfoTip } from "../components/InfoTip";
import { AppIcon } from "../components/AppIcon";

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

  const totalInvoices = await prisma.invoice.count({ where: { shop, status: "ACTIVE" } });
  const b2bInvoices = await prisma.invoice.count({ where: { shop, isB2B: true, status: "ACTIVE" } });

  // Calculate aggregates
  const aggregates = await prisma.invoice.aggregate({
    where: { shop, status: "ACTIVE" },
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
      date: new Date(inv.invoiceDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
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


  return (
    <Page
      titleMetadata={<InfoTip content="A summary of your invoices, sales and GST. Cancelled invoices are not counted." />}
      title="Overview"
      subtitle="Your invoices, sales and GST at a glance"
      primaryAction={{
        content: "Go to Invoices",
        onAction: () => navigate("/app/invoices"),
      }}
      secondaryActions={[
        {
          content: "GST Settings",
          onAction: () => navigate("/app/settings"),
        },
      ]}
    >
      <BlockStack gap="500">
        {!hasConfiguredGST && (
          <Banner
            title="GST Setup Incomplete"
            tone="warning"
            action={{ content: "Enter GSTIN & Trade Name", onAction: () => navigate("/app/settings") }}
          >
            <p>Your store needs a valid 15-digit GSTIN to generate legally compliant tax invoices under Rule 46 of the CGST Act.</p>
          </Banner>
        )}

        {/* KPI Metrics */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          {[
            { icon: "receipt", label: "Total Invoices", value: String(metrics.totalInvoices), note: `${metrics.b2bInvoices} B2B` },
            { icon: "rupee", label: "Taxable Sales", value: `₹${metrics.taxableValue.toLocaleString("en-IN")}`, note: "Before GST" },
            { icon: "percent", label: "GST on Sales", value: `₹${metrics.totalTax.toLocaleString("en-IN")}`, note: `IGST ₹${metrics.igstTotal.toLocaleString("en-IN")}` },
            { icon: "wallet", label: "Invoice Value", value: `₹${metrics.grandTotal.toLocaleString("en-IN")}`, note: "Including GST" },
          ].map((stat) => (
            <Card key={stat.label}>
              <div className="ong-stat">
                <span className="ong-stat-icon"><AppIcon name={stat.icon} /></span>
                <BlockStack gap="050">
                  <Text as="h3" variant="bodySm" tone="subdued">{stat.label}</Text>
                  <Text as="p" variant="headingMd" fontWeight="bold">{stat.value}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{stat.note}</Text>
                </BlockStack>
              </div>
            </Card>
          ))}
        </InlineGrid>

        <Card padding="0">
          <Box padding="400">
            <InlineGrid columns="1fr auto" alignItems="center">
              <Text as="h2" variant="headingMd">Recent Invoices</Text>
              <Button variant="plain" onClick={() => navigate("/app/invoices")}>View all</Button>
            </InlineGrid>
          </Box>
          {recentInvoices.length === 0 ? (
            <Box padding="600">
              <Text as="p" alignment="center" tone="subdued">No invoices yet. New ones appear here automatically.</Text>
            </Box>
          ) : (
            <div className="ong-table-wrap">
              <table className="ong-table">
                <thead>
                  <tr><th>Order</th><th>Customer</th><th>Amount</th><th>Invoice</th></tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <Link className="ong-strong" to={`/app/invoices/${inv.id}`}>#{inv.orderNumber}</Link>
                        <span className="ong-sub">{inv.date}</span>
                      </td>
                      <td>{inv.customer}<span className="ong-sub">{inv.isB2B ? "B2B" : "B2C"}</span></td>
                      <td className="ong-strong">{inv.amount}</td>
                      <td>{inv.invoiceNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
