import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  DataTable,
  TextField,
  Select,
  Button,
  Banner,
  InlineStack,
  Text,
  Badge,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch catalog from our DB
  const catalog = await prisma.hsnCatalog.findMany({
    where: { shop },
    orderBy: { productTitle: "asc" },
  });

  return json({
    catalog: catalog.map((item) => ({
      id: item.id,
      productId: item.shopifyProductId,
      title: item.productTitle,
      variantTitle: item.variantTitle || "Default",
      sku: item.sku || "N/A",
      hsnCode: item.hsnCode,
      gstRate: String(item.gstRate),
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update_hsn") {
    const id = formData.get("id") as string;
    const hsnCode = formData.get("hsnCode") as string;
    const gstRate = parseFloat(formData.get("gstRate") as string);

    await prisma.hsnCatalog.update({
      where: { id },
      data: {
        hsnCode: hsnCode.trim(),
        gstRate,
      },
    });

    return json({ success: true, message: "HSN code updated successfully" });
  }

  if (intent === "bulk_apply") {
    const defaultHsn = (formData.get("defaultHsn") as string).trim();
    const defaultRate = parseFloat(formData.get("defaultRate") as string);

    await prisma.hsnCatalog.updateMany({
      where: { shop },
      data: {
        hsnCode: defaultHsn,
        gstRate: defaultRate,
      },
    });

    return json({ success: true, message: "Applied default HSN & rate to all catalog items" });
  }

  return json({ success: false });
};

export default function HsnCatalogPage() {
  const { catalog } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [defaultHsn, setDefaultHsn] = useState("999999");
  const [defaultRate, setDefaultRate] = useState("18");

  const taxSlabOptions = [
    { label: "0% (Exempt)", value: "0" },
    { label: "5% (Apparel/Footwear < 1k, Food)", value: "5" },
    { label: "12% (Processed Foods, Apparel > 1k)", value: "12" },
    { label: "18% (Standard Goods & Electronics)", value: "18" },
    { label: "28% (Luxury & Automotive)", value: "28" },
  ];

  const handleBulkApply = () => {
    const fd = new FormData();
    fd.append("intent", "bulk_apply");
    fd.append("defaultHsn", defaultHsn);
    fd.append("defaultRate", defaultRate);
    submit(fd, { method: "post" });
  };

  const rows = catalog.map((item) => [
    <BlockStack gap="050">
      <Text as="span" fontWeight="bold">{item.title}</Text>
      <Text as="span" variant="bodyXs" tone="subdued">SKU: {item.sku} | Var: {item.variantTitle}</Text>
    </BlockStack>,
    <Badge tone="info">{item.hsnCode}</Badge>,
    `${item.gstRate}%`,
    <Button size="micro" onClick={() => {
      const newHsn = prompt("Enter new 6/8-digit HSN code:", item.hsnCode);
      if (newHsn && newHsn !== item.hsnCode) {
        const fd = new FormData();
        fd.append("intent", "update_hsn");
        fd.append("id", item.id);
        fd.append("hsnCode", newHsn);
        fd.append("gstRate", item.gstRate);
        submit(fd, { method: "post" });
      }
    }}>Edit</Button>,
  ]);

  return (
    <Page
      title="HSN Codes & Tax Slabs"
      subtitle="Map Harmonized System of Nomenclature (HSN) codes to every product"
    >
      <BlockStack gap="500">
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingSm">Quick Bulk Setup</Text>
            <Text as="p" tone="subdued">
              Assign a default HSN Code and GST Slab across all products in your store in one click:
            </Text>
            <InlineStack gap="300" align="start">
              <TextField
                label="Default HSN Code"
                value={defaultHsn}
                onChange={setDefaultHsn}
                autoComplete="off"
              />
              <Select
                label="Default GST Tax Slab"
                options={taxSlabOptions}
                value={defaultRate}
                onChange={setDefaultRate}
              />
              <div style={{ marginTop: "24px" }}>
                <Button variant="primary" onClick={handleBulkApply} loading={navigation.state === "submitting"}>
                  Apply to All
                </Button>
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card padding="0">
          <DataTable
            columnContentTypes={["text", "text", "text", "text"]}
            headings={["Product & SKU", "HSN / SAC Code", "GST Tax Slab", "Action"]}
            rows={rows}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}
