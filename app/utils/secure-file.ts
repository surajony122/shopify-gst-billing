/**
 * PDF and report routes require a Shopify session token. App Bridge adds it to
 * fetch() calls but not to plain links or window.open(), so files are fetched
 * first and then handed to the browser as a blob.
 */
async function fetchFile(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error((await response.text()) || `Could not load file (${response.status})`);
  }
  return response.blob();
}

export async function downloadSecureFile(url: string, filename: string): Promise<void> {
  const objectUrl = URL.createObjectURL(await fetchFile(url));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function openSecureFile(url: string): Promise<void> {
  // Open the window before awaiting, otherwise popup blockers reject it.
  const win = window.open("", "_blank");
  try {
    const objectUrl = URL.createObjectURL(await fetchFile(url));
    if (win) win.location.href = objectUrl;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    win?.close();
    throw error;
  }
}
