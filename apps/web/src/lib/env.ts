function isConfigured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getPublicRuntimeStatus() {
  return {
    authConfigured:
      isConfigured(process.env.AUTH0_DOMAIN) &&
      isConfigured(process.env.AUTH0_CLIENT_ID) &&
      isConfigured(process.env.AUTH0_CLIENT_SECRET) &&
      isConfigured(process.env.AUTH0_SECRET) &&
      isConfigured(process.env.APP_BASE_URL),
    databaseConfigured: isConfigured(process.env.DATABASE_URL),
  };
}
