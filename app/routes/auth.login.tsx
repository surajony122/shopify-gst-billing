import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { AppProvider, Card, Page, Text } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // A link from Shopify with ?shop= starts the install or login straight away.
  if (new URL(request.url).searchParams.get("shop")) {
    await login(request);
  }
  return json({});
};

/** Merchants install from Shopify, so this page only sends them back there. */
export default function LoginPage() {
  return (
    <AppProvider i18n={polarisTranslations}>
      <Page narrowWidth>
        <Card>
          <Text as="h1" variant="headingMd">Open WOM GST Invoice India from Shopify</Text>
          <Text as="p">To use this app, open it from Apps in your Shopify admin, or install it from the Shopify App Store.</Text>
        </Card>
      </Page>
    </AppProvider>
  );
}
