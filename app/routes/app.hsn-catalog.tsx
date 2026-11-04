import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/** HSN codes moved into GST Settings. Keeps old links and bookmarks working. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  params.set("tab", "hsn");
  return redirect(`/app/settings?${params.toString()}`);
};
