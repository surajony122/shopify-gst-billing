import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

/** On Render, refuse an unencrypted database connection. Render sets RENDER on its services. */
function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.RENDER || /[?&]sslmode=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require`;
}

const prisma = global.prisma || new PrismaClient({ datasources: { db: { url: databaseUrl() } } });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
