export function getPublicRuntimeStatus() {
  return {
    authConfigured: Boolean(process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
  };
}
