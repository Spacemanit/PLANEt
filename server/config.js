export function openSkyEnvironment(env = process.env) {
  const clientId = env.OPENSKY_CLIENT_ID?.trim() || "";
  const clientSecret = env.OPENSKY_CLIENT_SECRET?.trim() || "";
  return {
    credentials: { clientId, clientSecret },
    configured: Boolean(clientId && clientSecret),
    missingEnvironment: [
      !clientId && "OPENSKY_CLIENT_ID",
      !clientSecret && "OPENSKY_CLIENT_SECRET",
    ].filter(Boolean),
  };
}
