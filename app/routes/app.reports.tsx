import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
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
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getReturnPeriodRange } from "../services/gstr1-exporter.server";
import { downloadSecureFile } from "../utils/secure-file";
import { InfoTip } from "../components/InfoTip";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const params = new URL(request.url).searchParams;

  // Months follow Indian time, the same as the return file.
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const month = parseInt(params.get("month") || "", 10) || today.getUTCMonth() + 1;
  const year = parseInt(params.get("year") || "", 10) || today.getUTCFullYear();
  const { start, end } = getReturnPeriodRange(month, year);
  const period = { shop, status: "ACTIVE", invoiceDate: { gte: start, lt: end } };

  const [setting, b2bCount, b2cCount, agg, credits] = await Promise.all([
    prisma.storeSetting.findUnique({ where: { shop } }),
    prisma.invoice.count({ where: { ...period, isB2B: true } }),
    prisma.invoice.count({ where: { ...period, isB2B: false } }),
    prisma.invoice.aggregate({
      where: period,
      _sum: { subtotalTaxable: true, cgstTotal: true, sgstTotal: true, igstTotal: true },
    }),
    // Same credit notes as the return file, so these totals match it.
    prisma.creditNote.aggregate({
      where: { shop, date: { gte: start, lt: end }, invoice: { status: "ACTIVE" } },
      _sum: { taxableAdjusted: true, cgstAdjusted: true, sgstAdjusted: true, igstAdjusted: true },
    }),
  ]);

  return json({
    month,
    year,
    currentYear: today.getUTCFullYear(),
    isComposition: setting?.taxScheme === "composition",
    hasGstin: Boolean(setting?.gstin),
    b2bCount,
    b2cCount,
    taxableSales: Number(((agg._sum.subtotalTaxable || 0) - (credits._sum.taxableAdjusted || 0)).toFixed(2)),
    totalTax: Number(
      ((agg._sum.cgstTotal || 0) + (agg._sum.sgstTotal || 0) + (agg._sum.igstTotal || 0) -
        ((credits._sum.cgstAdjusted || 0) + (credits._sum.sgstAdjusted || 0) + (credits._sum.igstAdjusted || 0))).toFixed(2)
    ),
  });
};

export default function ReportsPage() {
  const data = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const selectedMonth = String(data.month).padStart(2, "0");
  const selectedYear = String(data.year);

  const changePeriod = (month: string, year: string) => setSearchParams({ month, year });

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

  const yearOptions = [data.currentYear, data.currentYear - 1, data.currentYear - 2].map((year) => ({
    label: String(year),
    value: String(year),
  }));

  return (
    <Page
      titleMetadata={<InfoTip content="GSTR-1 is your sales return. Pick a month to see its totals and download files for your CA or the GST portal." />} title="GSTR-1 Report" subtitle="Your monthly sales return, ready for your CA or the GST portal">
      <BlockStack gap="400">
        <Banner tone="info" title="What is GSTR-1?">
          <p>
            GSTR-1 is the return where you report your sales to the GST department, usually every month.
            Your buyers' input tax credit depends on it. The app prepares the file, and you or your CA check and file it.
          </p>
        </Banner>

        {data.isComposition && (
          <Banner tone="warning">
            <p>Composition dealers file CMP-08 and GSTR-4 instead of GSTR-1, so this export is turned off.</p>
          </Banner>
        )}

        {!data.hasGstin && !data.isComposition && (
          <Banner tone="warning">
            <p>Add your GSTIN in GST Settings before downloading the JSON file.</p>
          </Banner>
        )}

        {downloadError && (
          <Banner tone="critical" onDismiss={() => setDownloadError(null)}>
            <p>{downloadError}</p>
          </Banner>
        )}

        <Card>
          <InlineStack gap="400">
            <Select label="Month" options={monthOptions} value={selectedMonth} onChange={(month) => changePeriod(month, selectedYear)} />
            <Select label="Year" options={yearOptions} value={selectedYear} onChange={(year) => changePeriod(selectedMonth, year)} />
          </InlineStack>
        </Card>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Invoices</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{data.b2bCount + data.b2cCount}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{`${data.b2bCount} B2B, ${data.b2cCount} B2C`}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Taxable Sales (after credit notes)</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{`₹${data.taxableSales.toLocaleString("en-IN")}`}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">GST on Sales (after credit notes)</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">{`₹${data.totalTax.toLocaleString("en-IN")}`}</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Download</Text>
            <InlineStack gap="300">
              <Button variant="primary" disabled={data.isComposition} onClick={() => handleDownload("xlsx")}>
                Excel File (for your CA)
              </Button>
              <Button disabled={data.isComposition || !data.hasGstin} onClick={() => handleDownload("json")}>
                JSON File (for the GST portal)
              </Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Check the JSON file in the official GST offline tool before uploading it.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
