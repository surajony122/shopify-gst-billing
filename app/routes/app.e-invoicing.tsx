import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  DataTable,
  Button,
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

  const setting = await prisma.storeSetting.findUnique({ where: { shop } });

  // Get B2B Invoices that require e-invoicing
  const b2bInvoices = await prisma.invoice.findMany({
    where: { shop, isB2B: true },
    orderBy: { invoiceDate: "desc" },
    take: 30,
  });

  return json({
    einvoiceEnabled: setting?.einvoiceEnabled || false,
    b2bInvoices: b2bInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      orderNumber: inv.shopifyOrderNumber,
      date: new Date(inv.invoiceDate).toLocaleDateString("en-IN"),
      buyerGstin: inv.buyerGstin,
      amount: `₹${inv.grandTotal.toFixed(2)}`,
      irn: inv.irn || null,
      irnStatus: inv.irnStatus || "PENDING",
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const invoiceId = formData.get("invoiceId") as string;

  // In production, this pings the IRP API (via Sandbox/ClearTax/GSP)
  // We simulate generating a compliant 64-char IRN hash and Ack No
  const mockIrn = "b4f2c9" + Array.from({ length: 58 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const mockAck = String(Math.floor(100000000000000 + Math.random() * 900000000000000));

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      irn: mockIrn,
      irnStatus: "GENERATED",
      irnAckNo: mockAck,
    },
  });

  return json({ success: true, message: `e-Invoice generated! IRN: ${mockIrn.substring(0, 16)}...` });
};

export default function EInvoicingPage() {
  const { einvoiceEnabled, b2bInvoices } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const [selectedTab, setSelectedTab] = useState(0);

  const tabs = [
    { id: "e-invoices", content: "e-Invoices (IRN)" },
    { id: "e-way-bills", content: "e-Way Bills (> ₹50,000)" },
  ];

  const handleGenerateIrn = (id: string) => {
    const fd = new FormData();
    fd.append("invoiceId", id);
    submit(fd, { method: "post" });
  };

  const rows = b2bInvoices.map((inv) => [
    <Text as="span" fontWeight="bold">{inv.invoiceNumber}</Text>,
    `#${inv.orderNumber}`,
    inv.date,
    <Badge tone="info">{inv.buyerGstin || "N/A"}</Badge>,
    inv.amount,
    inv.irnStatus === "GENERATED" ? (
      <Badge tone="success">IRN Generated</Badge>
    ) : (
      <Badge tone="warning">Pending IRN</Badge>
    ),
    inv.irnStatus === "GENERATED" ? (
      <Text as="span" variant="bodyXs" tone="subdued">{inv.irn?.substring(0, 12)}...</Text>
    ) : (
      <Button size="micro" variant="primary" onClick={() => handleGenerateIrn(inv.id)}>
        Generate IRN
      </Button>
    ),
  ]);

  return (
    <Page
      title="e-Invoicing (IRN) & e-Way Bills"
      subtitle="Government IRP portal compliance for businesses with turnover > ₹5 Crores"
    >
      <BlockStack gap="500">
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Banner tone="info">
          <p>
            Under GST notification No. 10/2023, e-Invoicing is mandatory for all registered businesses
            whose aggregate annual turnover exceeds <strong>₹5 Crores</strong> in any preceding financial year.
          </p>
        </Banner>

        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "numeric", "text", "text"]}
              headings={["Invoice No.", "Order", "Date", "Buyer GSTIN", "Amount", "Status", "IRN / Action"]}
              rows={rows}
            />
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
