import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  DataTable,
  Banner,
  Text,
  Badge,
  Tabs,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Earlier versions stored random IRNs. No IRP connection has ever existed, so none of
  // them are genuine. Remove this cleanup when a real IRP integration is added.
  await prisma.invoice.updateMany({
    where: { shop, irnStatus: "GENERATED" },
    data: { irn: null, irnAckNo: null, irnStatus: null },
  });

  const [b2bInvoices, ewayInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: { shop, isB2B: true, status: "ACTIVE" },
      orderBy: { invoiceDate: "desc" },
      take: 30,
    }),
    prisma.invoice.findMany({
      where: { shop, ewayBillRequired: true, status: "ACTIVE" },
      orderBy: { invoiceDate: "desc" },
      take: 30,
    }),
  ]);

  const toRow = (inv: (typeof b2bInvoices)[number]) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    orderNumber: inv.shopifyOrderNumber,
    date: new Date(inv.invoiceDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
    buyerGstin: inv.buyerGstin,
    amount: `₹${inv.grandTotal.toFixed(2)}`,
  });

  return json({ b2bInvoices: b2bInvoices.map(toRow), ewayInvoices: ewayInvoices.map(toRow) });
};

export default function EInvoicingPage() {
  const { b2bInvoices, ewayInvoices } = useLoaderData<typeof loader>();
  const [selectedTab, setSelectedTab] = useState(0);

  const tabs = [
    { id: "e-invoices", content: "e-Invoices (IRN)" },
    { id: "e-way-bills", content: "e-Way Bills" },
  ];

  const rows = (selectedTab === 0 ? b2bInvoices : ewayInvoices).map((inv) => [
    <Text as="span" fontWeight="bold">{inv.invoiceNumber}</Text>,
    `#${inv.orderNumber}`,
    inv.date,
    <Badge tone="info">{inv.buyerGstin || "N/A"}</Badge>,
    inv.amount,
    <Badge tone="warning">{selectedTab === 0 ? "File on IRP portal" : "File on e-Way Bill portal"}</Badge>,
  ]);

  return (
    <Page
      title="e-Invoicing (IRN) & e-Way Bills"
      subtitle="Invoices that may need filing on the government portals"
    >
      <BlockStack gap="500">
        <Banner tone="warning" title="Not connected to the government portals">
          <p>
            This app cannot generate IRNs or e-Way Bills yet. Use this list to see which invoices
            may need them, then generate them on the official IRP and e-Way Bill portals.
          </p>
        </Banner>

        <Banner tone="info">
          <p>
            Under GST notification No. 10/2023, e-Invoicing is mandatory for all registered businesses
            whose aggregate annual turnover exceeds <strong>₹5 Crores</strong> in any preceding financial year.
          </p>
        </Banner>

        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
              headings={["Invoice No.", "Order", "Date", "Buyer GSTIN", "Amount", "Next Step"]}
              rows={rows}
            />
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
