import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://zkde.fi";

  return [
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/test`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/products/modelbridge`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/products/privacy-pools`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/products/private-vault`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/products/portable-risk-profile`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
  ];
}
