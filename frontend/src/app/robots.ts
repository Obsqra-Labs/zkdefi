import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/agent/", "/trade/", "/vault/", "/profile/"],
      },
    ],
    sitemap: "https://zkde.fi/sitemap.xml",
  };
}
