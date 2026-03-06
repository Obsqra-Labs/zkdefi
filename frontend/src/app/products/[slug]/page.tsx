import { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";
import {
  PRODUCT_CATEGORIES,
  PRODUCTS,
  getCategoryById,
  getProductBySlug,
} from "@/lib/products/catalog";

interface ProductRouteProps {
  params: {
    slug: string;
  };
}

export function generateStaticParams() {
  return PRODUCTS.map((product) => ({ slug: product.slug }));
}

export function generateMetadata({ params }: ProductRouteProps): Metadata {
  const product = getProductBySlug(params.slug);

  if (!product) {
    return {
      title: "Product Not Found | zkde.fi",
    };
  }

  return {
    title: `${product.title} | zkde.fi`,
    description: product.summary,
  };
}

export default function ProductSlugPage({ params }: ProductRouteProps) {
  const product = getProductBySlug(params.slug);
  if (!product) {
    notFound();
  }

  const category = getCategoryById(product.categoryId);
  if (!category) {
    // Defensive guard to keep product pages resilient if catalog mappings drift.
    const fallbackCategory = PRODUCT_CATEGORIES[0];
    return <ProductPageFrame product={product} category={fallbackCategory} />;
  }

  return <ProductPageFrame product={product} category={category} />;
}
