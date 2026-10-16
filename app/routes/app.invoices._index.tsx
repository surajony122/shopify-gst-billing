import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
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
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";

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
  const navigate = useNavigate();
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
              <Badge tone="info">{buyerGstin}</Badge>
            ) : (
              <Text as="span" variant="bodyXs" tone="subdued">B2C</Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm">{placeOfSupply}</Text>
            <Badge tone={isInterState ? "attention" : "success"}>
              {isInterState ? "IGST" : "CGST+SGST"}
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
      title="Tax Invoices"
      subtitle={`Total ${totalCount} invoices issued`}
      primaryAction={{
        content: "Export GSTR-1 Excel",
        url: "/app/reports",
      }}
    >
      <BlockStack gap="400">
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
          <IndexTable
            resourceName={resourceName}
            itemCount={invoices.length}
            selectedItemsCount={
              allResourcesSelected ? "All" : selectedResources.length
            }
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: "Invoice No." },
              { title: "Order" },
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
        </Card>
      </BlockStack>
    </Page>
  );
}
