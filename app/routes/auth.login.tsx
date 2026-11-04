import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { useState } from "react";
import { AppProvider, Button, Card, FormLayout, Page, Text, TextField } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // A link with ?shop= starts the install or login straight away.
  if (new URL(request.url).searchParams.get("shop")) {
    await login(request);
  }
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = await login(request);
  return json({ shopError: errors.shop ? "Enter a valid .myshopify.com store address" : undefined });
};

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page narrowWidth>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text as="h1" variant="headingMd">Log in to GST Invoicing</Text>
              <TextField
                name="shop"
                label="Store address"
                helpText="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={actionData?.shopError}
              />
              <Button submit variant="primary">Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </AppProvider>
  );
}
