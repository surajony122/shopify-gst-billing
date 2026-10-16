import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  useIndexResourceState,
  Text,
  Badge,
  BlockStack,
  Box,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const creditNotes = await prisma.creditNote.findMany({
    where: { shop },
    include: { invoice: true },
    orderBy: { date: "desc" },
    take: 50,
  });

  return json({
    creditNotes: creditNotes.map((cn) => ({
      id: cn.id,
      creditNoteNumber: cn.creditNoteNumber,
      invoiceNumber: cn.invoice.invoiceNumber,
      date: new Date(cn.date).toLocaleDateString("en-IN"),
      reason: cn.reason || "Customer Return / Order Cancellation",
      taxableAdjusted: `₹${cn.taxableAdjusted.toFixed(2)}`,
      cgstAdjusted: `₹${cn.cgstAdjusted.toFixed(2)}`,
      sgstAdjusted: `₹${cn.sgstAdjusted.toFixed(2)}`,
      igstAdjusted: `₹${cn.igstAdjusted.toFixed(2)}`,
      grandTotalAdjusted: `₹${cn.grandTotalAdjusted.toFixed(2)}`,
    })),
  });
};

export default function CreditNotesPage() {
  const { creditNotes } = useLoaderData<typeof loader>();

  const resourceName = {
    singular: "credit note",
    plural: "credit notes",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(creditNotes);

  const rowMarkup = creditNotes.map(
    (
      {
        id,
        creditNoteNumber,
        invoiceNumber,
        date,
        reason,
        taxableAdjusted,
        cgstAdjusted,
        sgstAdjusted,
        igstAdjusted,
        grandTotalAdjusted,
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
            {creditNoteNumber}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone="info">{invoiceNumber}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{date}</IndexTable.Cell>
        <IndexTable.Cell>{reason}</IndexTable.Cell>
        <IndexTable.Cell>{taxableAdjusted}</IndexTable.Cell>
        <IndexTable.Cell>{cgstAdjusted}</IndexTable.Cell>
        <IndexTable.Cell>{sgstAdjusted}</IndexTable.Cell>
        <IndexTable.Cell>{igstAdjusted}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {grandTotalAdjusted}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  return (
    <Page
      title="Credit Notes (Section 34)"
      subtitle="Automated adjustments for cancelled orders, returns, and refunds"
    >
      <BlockStack gap="400">
        <Banner tone="info">
          <p>
            Credit Notes are automatically generated when an order refund is processed in Shopify.
            They adjust your monthly tax liability in GSTR-1 and GSTR-3B filings.
          </p>
        </Banner>

        <Card padding="0">
          {creditNotes.length === 0 ? (
            <Box padding="600">
              <Text as="p" alignment="center" tone="subdued">
                No credit notes recorded yet. Refunds processed in Shopify will appear here automatically.
              </Text>
            </Box>
          ) : (
            <IndexTable
              resourceName={resourceName}
              itemCount={creditNotes.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Credit Note #" },
                { title: "Original Invoice #" },
                { title: "Date" },
                { title: "Reason" },
                { title: "Taxable Adj." },
                { title: "CGST" },
                { title: "SGST" },
                { title: "IGST" },
                { title: "Total Refunded" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
