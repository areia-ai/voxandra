export default {
  providers: [
    {
      // Convex sets CONVEX_SITE_URL on every deployment, and Convex Auth uses
      // it as the issuer of the JWTs it signs, so each deployment trusts only
      // its own tokens.
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
