import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineGrid,
  Text,
  Banner,
  Button,
  Select,
  InlineStack,
  Divider,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { downloadSecureFile } from "../utils/secure-file";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const totalInvoices = await prisma.invoice.count({ where: { shop } });
  const b2bCount = await prisma.invoice.count({ where: { shop, isB2B: true } });
  const b2cCount = await prisma.invoice.count({ where: { shop, isB2B: false } });

  const agg = await prisma.invoice.aggregate({
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
    totalInvoices,
    b2bCount,
    b2cCount,
    taxableSales: agg._sum.subtotalTaxable || 0,
    cgstTotal: agg._sum.cgstTotal || 0,
    sgstTotal: agg._sum.sgstTotal || 0,
    igstTotal: agg._sum.igstTotal || 0,
    totalTax: (agg._sum.cgstTotal || 0) + (agg._sum.sgstTotal || 0) + (agg._sum.igstTotal || 0),
    grandTotal: agg._sum.grandTotal || 0,
  });
};

export default function ReportsPage() {
  const data = useLoaderData<typeof loader>();
  const today = new Date();
  const currentYear = today.getFullYear();
  const [selectedMonth, setSelectedMonth] = useState(String(today.getMonth() + 1).padStart(2, "0"));
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = (format: "xlsx" | "json") => {
    setDownloadError(null);
    downloadSecureFile(
      `/api/reports/gstr1?format=${format}&month=${selectedMonth}&year=${selectedYear}`,
      `GSTR1_${selectedMonth}_${selectedYear}.${format}`
    ).catch((error) => setDownloadError(error.message));
  };

  const monthOptions = [
    { label: "January", value: "01" },
    { label: "February", value: "02" },
    { label: "March", value: "03" },
    { label: "April", value: "04" },
    { label: "May", value: "05" },
    { label: "June", value: "06" },
    { label: "July", value: "07" },
    { label: "August", value: "08" },
    { label: "September", value: "09" },
    { label: "October", value: "10" },
    { label: "November", value: "11" },
    { label: "December", value: "12" },
  ];

  const yearOptions = [currentYear, currentYear - 1, currentYear - 2].map((year) => ({
    label: String(year),
    value: String(year),
  }));

  return (
    <Page
      title="GST Filing Reports (GSTR-1 & GSTR-3B)"
      subtitle="Export CA-ready spreadsheets and JSON files formatted for the official GST portal"
    >
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingSm">Select Return Period</Text>
            <InlineStack gap="400">
              <Select
                label="Month"
                options={monthOptions}
                value={selectedMonth}
                onChange={setSelectedMonth}
              />
              <Select
                label="Year"
                options={yearOptions}
                value={selectedYear}
                onChange={setSelectedYear}
              />
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Aggregate Cards */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">B2B Supplies</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{data.b2bCount} Orders</Text>
              <Text as="p" variant="bodyXs" tone="subdued">With Buyer GSTIN</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">B2C Retail</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{data.b2cCount} Orders</Text>
              <Text as="p" variant="bodyXs" tone="subdued">Unregistered Consumers</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Total Taxable Value</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">₹{data.taxableSales.toLocaleString("en-IN")}</Text>
              <Text as="p" variant="bodyXs" tone="success">Net Sales</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Total Output GST</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">₹{data.totalTax.toLocaleString("en-IN")}</Text>
              <Text as="p" variant="bodyXs" tone="subdued">CGST+SGST+IGST</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Download Actions */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Export Return Files</Text>
            <Text as="p" tone="subdued">
              Give these files to your Chartered Accountant (CA), or check the JSON in the official GST offline tool before filing:
            </Text>
            {downloadError && <Banner tone="critical"><p>{downloadError}</p></Banner>}
            <Divider />
            <InlineStack gap="300">
              <Button
                variant="primary"
                onClick={() => handleDownload("xlsx")}
              >
                Download GSTR-1 Excel (Multi-Sheet)
              </Button>
              <Button onClick={() => handleDownload("json")}>
                Download GSTR-1 JSON (GST Portal Schema)
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
