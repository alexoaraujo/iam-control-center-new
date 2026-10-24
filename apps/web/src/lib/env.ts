function isConfigured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getPublicRuntimeStatus() {
  return {
    authConfigured:
      isConfigured(process.env.AUTH0_DOMAIN) &&
      isConfigured(process.env.AUTH0_CLIENT_ID),
    databaseConfigured: isConfigured(process.env.DATABASE_URL),
  };
}
