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
  Tabs,
  Box,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // 1. Fetch individual product/variant mappings from our DB
  const catalog = await prisma.hsnCatalog.findMany({
    where: { shop },
    orderBy: { productTitle: "asc" },
  });

  // 2. Fetch saved collection HSN mappings
  const collectionMappings = await prisma.collectionHsn.findMany({
    where: { shop },
  });

  // 3. Fetch Shopify Collections via GraphQL
  let shopifyCollections: Array<{ id: string; title: string }> = [];
  try {
    const res = await admin.graphql(`
      query getCollections {
        collections(first: 50) {
          nodes {
            id
            title
          }
        }
      }
    `);
    const jsonRes = await res.json();
    shopifyCollections = jsonRes.data?.collections?.nodes || [];
  } catch (err) {
    console.error("Error fetching collections:", err);
  }

  // Merge Shopify collections with saved HSN mappings
  const mergedCollections = shopifyCollections.map((col) => {
    const numericId = col.id.replace("gid://shopify/Collection/", "");
    const mapping = collectionMappings.find(
      (m) => m.shopifyCollectionId === numericId || m.shopifyCollectionId === col.id
    );
    return {
      id: numericId,
      gid: col.id,
      title: col.title,
      hsnCode: mapping?.hsnCode || "999999",
      gstRate: String(mapping?.gstRate ?? 18),
    };
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
    collections: mergedCollections,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_collection_hsn") {
    const collectionId = formData.get("collectionId") as string;
    const collectionTitle = formData.get("collectionTitle") as string;
    const hsnCode = (formData.get("hsnCode") as string).trim();
    const gstRate = parseFloat(formData.get("gstRate") as string || "18");

    await prisma.collectionHsn.upsert({
      where: {
        shop_shopifyCollectionId: {
          shop,
          shopifyCollectionId: collectionId,
        },
      },
      update: {
        hsnCode,
        gstRate,
        collectionTitle,
      },
      create: {
        shop,
        shopifyCollectionId: collectionId,
        collectionTitle,
        hsnCode,
        gstRate,
      },
    });

    return json({
      success: true,
      message: `HSN code ${hsnCode} (${gstRate}%) successfully saved for collection "${collectionTitle}"!`,
    });
  }

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
  const { catalog, collections } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selectedTab, setSelectedTab] = useState(0);
  const [defaultHsn, setDefaultHsn] = useState("999999");
  const [defaultRate, setDefaultRate] = useState("18");

  const taxSlabOptions = [
    { label: "0% (Exempt / Nil-Rated Goods)", value: "0" },
    { label: "5% (Apparel/Footwear < ₹1000, Food Items)", value: "5" },
    { label: "12% (Processed Foods, Apparel > ₹1000)", value: "12" },
    { label: "18% (Standard Goods, Services & Electronics)", value: "18" },
    { label: "28% (Luxury & Automotive)", value: "28" },
  ];

  const tabs = [
    { id: "collections-hsn", content: `Collections HSN Mapping (${collections.length} Collections)` },
    { id: "products-hsn", content: `Product & Variant HSN (${catalog.length} Products)` },
  ];

  const handleBulkApply = () => {
    const fd = new FormData();
    fd.append("intent", "bulk_apply");
    fd.append("defaultHsn", defaultHsn);
    fd.append("defaultRate", defaultRate);
    submit(fd, { method: "post" });
  };

  const handleSaveCollectionHsn = (col: any, hsn: string, rate: string) => {
    const fd = new FormData();
    fd.append("intent", "save_collection_hsn");
    fd.append("collectionId", col.id);
    fd.append("collectionTitle", col.title);
    fd.append("hsnCode", hsn);
    fd.append("gstRate", rate);
    submit(fd, { method: "post" });
  };

  // Collection Rows
  const collectionRows = collections.map((col) => [
    <Text as="span" fontWeight="bold">{col.title}</Text>,
    <Badge tone="info">{col.hsnCode}</Badge>,
    <Badge tone="success">{col.gstRate}% GST</Badge>,
    <Button
      size="micro"
      variant="primary"
      onClick={() => {
        const newHsn = prompt(`Enter 6 or 8-digit HSN code for collection "${col.title}":`, col.hsnCode);
        if (newHsn && newHsn.trim() !== "") {
          const newRate = prompt(`Enter GST Tax Slab rate (0, 5, 12, 18, 28):`, col.gstRate) || "18";
          handleSaveCollectionHsn(col, newHsn.trim(), newRate.trim());
        }
      }}
    >
      Edit HSN & Slab
    </Button>,
  ]);

  // Product Rows
  const productRows = catalog.map((item) => [
    <BlockStack gap="050">
      <Text as="span" fontWeight="bold">{item.title}</Text>
      <Text as="span" variant="bodyXs" tone="subdued">SKU: {item.sku} | Var: {item.variantTitle}</Text>
    </BlockStack>,
    <Badge tone="info">{item.hsnCode}</Badge>,
    `${item.gstRate}%`,
    <Button
      size="micro"
      onClick={() => {
        const newHsn = prompt("Enter new 6/8-digit HSN code:", item.hsnCode);
        if (newHsn && newHsn !== item.hsnCode) {
          const fd = new FormData();
          fd.append("intent", "update_hsn");
          fd.append("id", item.id);
          fd.append("hsnCode", newHsn);
          fd.append("gstRate", item.gstRate);
          submit(fd, { method: "post" });
        }
      }}
    >
      Edit
    </Button>,
  ]);

  return (
    <Page
      title="HSN Codes & Tax Slabs"
      subtitle="Set HSN codes and GST tax slabs by Collection or per Product/Variant"
    >
      <BlockStack gap="500">
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        {/* Global Bulk Setup */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingSm">Store-wide Default Tax Slab</Text>
            <Text as="p" tone="subdued">
              If a product or collection does not have an individual HSN code assigned, this default tax slab will apply:
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

        {/* Tabs for Collection-Wise vs Product-Wise */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            {selectedTab === 0 ? (
              <Box padding="0">
                {collections.length === 0 ? (
                  <Box padding="600">
                    <Text as="p" alignment="center" tone="subdued">
                      No Shopify Collections found for this store.
                    </Text>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={["Shopify Collection", "Assigned HSN Code", "GST Tax Slab", "Action"]}
                    rows={collectionRows}
                  />
                )}
              </Box>
            ) : (
              <Box padding="0">
                {catalog.length === 0 ? (
                  <Box padding="600">
                    <Text as="p" alignment="center" tone="subdued">
                      No individual product overrides yet. Collection mappings or the default store HSN will be used.
                    </Text>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={["Product & SKU", "HSN / SAC Code", "GST Tax Slab", "Action"]}
                    rows={productRows}
                  />
                )}
              </Box>
            )}
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
