import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { getPreviewE2ESessionConfig } from "./auth0-session";

export const auth0 = new Auth0Client({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  secret: process.env.AUTH0_SECRET!,
  appBaseUrl: process.env.APP_BASE_URL!,
  session: getPreviewE2ESessionConfig(process.env),
});
