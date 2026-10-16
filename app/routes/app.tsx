import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey} i18n={polarisTranslations}>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard (डैशबोर्ड)</Link>
        <Link to="/app/invoices">GST Invoices (पक्का बिल)</Link>
        <Link to="/app/credit-notes">Credit Notes (रिफंड / वापसी)</Link>
        <Link to="/app/hsn-catalog">HSN & Tax Slabs (HSN कोड)</Link>
        <Link to="/app/e-invoicing">e-Invoicing (IRN पोर्टल)</Link>
        <Link to="/app/reports">GSTR-1 Reports (सीए रिपोर्ट)</Link>
        <Link to="/app/settings">GST Settings (जीएसटी प्रोफाइल)</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
