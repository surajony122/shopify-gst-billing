import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { Page, Card, BlockStack, Banner, Badge, Button, InlineGrid, InlineStack, List, ProgressBar, Text } from "@shopify/polaris";
import { authenticate, GROWTH_PLAN, PRO_PLAN } from "../shopify.server";
import { InfoTip } from "../components/InfoTip";
import { isDevelopmentStore } from "../services/invoice-builder.server";
import { getPlanUsage, savePlan } from "../services/plans.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const check = await billing.check({ plans: [GROWTH_PLAN, PRO_PLAN], isTest: await isDevelopmentStore(admin) });
  // Also corrects the saved plan right after returning from Shopify's approval page.
  await savePlan(session.shop, check.appSubscriptions[0]?.name || "Free");
  return json(await getPlanUsage(session.shop));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const plan = (await request.formData()).get("plan") as string;
  const isTest = await isDevelopmentStore(admin);

  if (plan === GROWTH_PLAN || plan === PRO_PLAN) {
    // Redirects to Shopify's approval page. Replacing a plan cancels the old one.
    return billing.request({
      plan,
      isTest,
      returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/billing`,
    });
  }

  if (plan === "Free") {
    const check = await billing.check({ plans: [GROWTH_PLAN, PRO_PLAN], isTest });
    for (const subscription of check.appSubscriptions) {
      await billing.cancel({ subscriptionId: subscription.id, isTest, prorate: true });
    }
    await savePlan(session.shop, "Free");
    return json({ message: "You're now on the Free plan." });
  }

  return json({ message: "Choose a valid plan." });
};

const PLANS = [
  { name: "Free", price: "$0", features: ["25 invoices a month", "Automatic GST invoices", "Standard template", "Credit notes and HSN codes"] },
  { name: "Growth", price: "$6", features: ["500 invoices a month", "All templates", "Logo and signature", "GSTR-1 Excel and JSON files"] },
  { name: "Pro", price: "$15", features: ["Unlimited invoices", "Everything in Growth", "Priority support"] },
];

export default function BillingPage() {
  const { plan, used, limit } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const pending = navigation.formData?.get("plan");

  const choose = (name: string) => {
    const fd = new FormData();
    fd.append("plan", name);
    submit(fd, { method: "post" });
  };

  return (
    <Page
      titleMetadata={<InfoTip content="Paid plans start with a 7-day free trial and are billed by Shopify every 30 days." />}
      title="Plan & Billing"
      subtitle="Paid plans include a 7-day free trial"
    >
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="info"><p>{actionData.message}</p></Banner>}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">{`Invoices this month: ${used}${limit === null ? "" : ` of ${limit}`}`}</Text>
            {limit !== null && <ProgressBar progress={Math.min(100, (used / limit) * 100)} size="small" />}
            <Text as="p" variant="bodySm" tone="subdued">
              Invoices are still created above the limit, but those can't be downloaded until you upgrade.
            </Text>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          {PLANS.map((item) => (
            <Card key={item.name}>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">{item.name}</Text>
                  {plan === item.name && <Badge tone="success">Current</Badge>}
                </InlineStack>
                <Text as="p" variant="headingLg">{`${item.price} / month`}</Text>
                <List>
                  {item.features.map((feature) => <List.Item key={feature}>{feature}</List.Item>)}
                </List>
                <Button
                  variant={plan === item.name ? undefined : "primary"}
                  disabled={plan === item.name}
                  loading={pending === item.name}
                  onClick={() => choose(item.name)}
                >
                  {plan === item.name ? "Current plan" : item.name === "Free" ? "Switch to Free" : "Start 7-day free trial"}
                </Button>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
