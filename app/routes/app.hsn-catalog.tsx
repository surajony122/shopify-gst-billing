import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Box,
  Button,
  DataTable,
  Banner,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
  Badge,
  Tabs,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const HSN_FORMAT = /^\d{4,8}$/;

const gidNumber = (gid: string) => gid.split("/").pop() as string;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [setting, productMappings, collectionMappings] = await Promise.all([
    prisma.storeSetting.findUnique({ where: { shop } }),
    prisma.hsnCatalog.findMany({ where: { shop } }),
    prisma.collectionHsn.findMany({ where: { shop } }),
  ]);

  let shopifyCollections: Array<{ id: string; title: string }> = [];
  let shopifyProducts: Array<{ id: string; title: string }> = [];
  let loadFailed = false;
  try {
    const res = await admin.graphql(`
      query getCatalog {
        collections(first: 100, sortKey: TITLE) { nodes { id title } }
        products(first: 100, sortKey: TITLE) { nodes { id title } }
      }
    `);
    const body = (await res.json()) as any;
    shopifyCollections = body.data?.collections?.nodes || [];
    shopifyProducts = body.data?.products?.nodes || [];
  } catch (err) {
    console.error("Error fetching catalog:", err);
    loadFailed = true;
  }

  return json({
    loadFailed,
    defaultHsnCode: setting?.defaultHsnCode || "999999",
    defaultGstRate: String(setting?.defaultGstRate ?? 18),
    collections: shopifyCollections.map((col) => {
      const id = gidNumber(col.id);
      const mapping = collectionMappings.find((m) => m.shopifyCollectionId === id);
      return {
        id,
        title: col.title,
        hsnCode: mapping?.hsnCode || null,
        gstRate: mapping ? String(mapping.gstRate) : null,
      };
    }),
    products: shopifyProducts.map((product) => {
      const id = gidNumber(product.id);
      const mapping = productMappings.find((m) => m.shopifyProductId === id && !m.shopifyVariantId);
      return {
        id,
        title: product.title,
        hsnCode: mapping?.hsnCode || null,
        gstRate: mapping ? String(mapping.gstRate) : null,
      };
    }),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const hsnCode = ((formData.get("hsnCode") as string) || "").trim();
  const gstRate = parseFloat(formData.get("gstRate") as string);
  const title = (formData.get("title") as string) || "";
  const id = (formData.get("id") as string) || "";

  if (!HSN_FORMAT.test(hsnCode)) {
    return json({ success: false, message: "HSN or SAC code must be 4 to 8 digits." });
  }
  if (!(gstRate >= 0 && gstRate <= 100)) {
    return json({ success: false, message: "Choose a valid GST rate." });
  }

  if (intent === "save_default") {
    await prisma.storeSetting.upsert({
      where: { shop },
      update: { defaultHsnCode: hsnCode, defaultGstRate: gstRate },
      create: { shop, defaultHsnCode: hsnCode, defaultGstRate: gstRate },
    });
    return json({ success: true, message: `Store default saved: HSN ${hsnCode} at ${gstRate}%.` });
  }

  if (intent === "save_collection_hsn") {
    await prisma.collectionHsn.upsert({
      where: { shop_shopifyCollectionId: { shop, shopifyCollectionId: id } },
      update: { hsnCode, gstRate, collectionTitle: title },
      create: { shop, shopifyCollectionId: id, collectionTitle: title, hsnCode, gstRate },
    });
    return json({ success: true, message: `Saved HSN ${hsnCode} at ${gstRate}% for "${title}".` });
  }

  if (intent === "save_product_hsn") {
    // A null variant cannot be matched by the unique index, so look the row up first.
    const existing = await prisma.hsnCatalog.findFirst({
      where: { shop, shopifyProductId: id, shopifyVariantId: null },
    });
    if (existing) {
      await prisma.hsnCatalog.update({
        where: { id: existing.id },
        data: { hsnCode, gstRate, productTitle: title },
      });
    } else {
      await prisma.hsnCatalog.create({
        data: { shop, shopifyProductId: id, productTitle: title, hsnCode, gstRate },
      });
    }
    return json({ success: true, message: `Saved HSN ${hsnCode} at ${gstRate}% for "${title}".` });
  }

  return json({ success: false, message: "Invalid action" });
};

interface EditTarget {
  intent: "save_collection_hsn" | "save_product_hsn";
  id: string;
  title: string;
  hsnCode: string;
  gstRate: string;
}

export default function HsnCatalogPage() {
  const { loadFailed, defaultHsnCode, defaultGstRate, collections, products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selectedTab, setSelectedTab] = useState(0);
  const [defaultHsn, setDefaultHsn] = useState(defaultHsnCode);
  const [defaultRate, setDefaultRate] = useState(defaultGstRate);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const rateOptions = (current?: string) => {
    const options = [
      { label: "0% (Exempt / Nil-Rated Goods)", value: "0" },
      { label: "5% (Apparel/Footwear ≤ ₹2,500, Food Items)", value: "5" },
      { label: "18% (Standard Goods, Services & Electronics)", value: "18" },
      { label: "40% (Luxury & Sin Goods)", value: "40" },
    ];
    // Keep older rates visible so a saved value is never silently shown as something else.
    return current && !options.some((o) => o.value === current)
      ? [...options, { label: `${current}% (older rate, please review)`, value: current }]
      : options;
  };

  const tabs = [
    { id: "collections-hsn", content: `Collections (${collections.length})` },
    { id: "products-hsn", content: `Products (${products.length})` },
  ];

  const save = (intent: string, fields: Record<string, string>) => {
    const fd = new FormData();
    fd.append("intent", intent);
    Object.entries(fields).forEach(([key, value]) => fd.append(key, value));
    submit(fd, { method: "post" });
  };

  const handleSaveEdit = () => {
    if (!editing) return;
    save(editing.intent, {
      id: editing.id,
      title: editing.title,
      hsnCode: editing.hsnCode,
      gstRate: editing.gstRate,
    });
    setEditing(null);
  };

  const rows = (items: typeof products, intent: EditTarget["intent"], fallbackLabel: string) =>
    items.map((item) => [
      <Text as="span" fontWeight="bold">{item.title}</Text>,
      item.hsnCode ? <Badge tone="info">{item.hsnCode}</Badge> : <Text as="span" tone="subdued">{fallbackLabel}</Text>,
      item.gstRate ? `${item.gstRate}%` : <Text as="span" tone="subdued">{fallbackLabel}</Text>,
      <Button
        size="micro"
        variant="primary"
        onClick={() =>
          setEditing({
            intent,
            id: item.id,
            title: item.title,
            hsnCode: item.hsnCode || "",
            gstRate: item.gstRate || defaultRate,
          })
        }
      >
        Edit
      </Button>,
    ]);

  return (
    <Page
      title="HSN Codes & Tax Slabs"
      subtitle="Each invoice line uses the product's code, then its collection's code, then the store default"
    >
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`HSN and GST rate: ${editing?.title || ""}`}
        primaryAction={{ content: "Save", onAction: handleSaveEdit }}
        secondaryActions={[{ content: "Cancel", onAction: () => setEditing(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="HSN or SAC code"
              helpText="4 to 8 digits"
              value={editing?.hsnCode || ""}
              onChange={(value) => editing && setEditing({ ...editing, hsnCode: value })}
              autoComplete="off"
            />
            <Select
              label="GST rate"
              options={rateOptions(editing?.gstRate)}
              value={editing?.gstRate}
              onChange={(value) => editing && setEditing({ ...editing, gstRate: value })}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      <BlockStack gap="500">
        {actionData && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        {loadFailed && (
          <Banner tone="critical">
            <p>Could not load your products and collections from Shopify. Reload the page to try again.</p>
          </Banner>
        )}

        {defaultHsnCode === "999999" && (
          <Banner tone="warning" title="Set your real HSN codes">
            <p>
              999999 is only a placeholder. Set the store default below and add codes for your products
              or collections, then regenerate any invoices that used the placeholder.
            </p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingSm">Store-wide Default</Text>
            <Text as="p" tone="subdued">
              Used for any product that has no code of its own and is not in a mapped collection.
            </Text>
            <InlineStack gap="300" align="start" blockAlign="end">
              <TextField
                label="Default HSN Code"
                value={defaultHsn}
                onChange={setDefaultHsn}
                autoComplete="off"
              />
              <Select
                label="Default GST Rate"
                options={rateOptions(defaultRate)}
                value={defaultRate}
                onChange={setDefaultRate}
              />
              <Button
                variant="primary"
                onClick={() => save("save_default", { hsnCode: defaultHsn, gstRate: defaultRate })}
                loading={navigation.state === "submitting"}
              >
                Save Default
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            {selectedTab === 0 ? (
              collections.length === 0 ? (
                <Box padding="600">
                  <Text as="p" alignment="center" tone="subdued">No Shopify collections found for this store.</Text>
                </Box>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Collection", "HSN Code", "GST Rate", "Action"]}
                  rows={rows(collections, "save_collection_hsn", "Store default")}
                />
              )
            ) : products.length === 0 ? (
              <Box padding="600">
                <Text as="p" alignment="center" tone="subdued">No Shopify products found for this store.</Text>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={["Product", "HSN Code", "GST Rate", "Action"]}
                rows={rows(products, "save_product_hsn", "Collection or default")}
              />
            )}
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
