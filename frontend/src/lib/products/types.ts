export type ProductStatus = "BUILT" | "READY" | "ADAPTER";

export type ProductCategoryId =
  | "private-ledger-vault"
  | "private-defi"
  | "private-lending-zk-trust"
  | "automation-infra";

export interface ProductCategory {
  id: ProductCategoryId;
  title: string;
  description: string;
}

export type SandboxMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface SandboxAction {
  id: string;
  title: string;
  description: string;
  problemSolved?: string;
  plainLanguage?: string;
  whyItMatters?: string;
  successSignal?: string;
  method: SandboxMethod;
  endpointCandidates: string[];
  sampleQuery?: Record<string, string | number | boolean>;
  sampleBody?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface ProductDefinition {
  slug: string;
  title: string;
  status: ProductStatus;
  categoryId: ProductCategoryId;
  summary: string;
  description: string;
  capabilities: string[];
  docsHref: string;
  standaloneActions: SandboxAction[];
  advancedLink?: {
    href: string;
    label: string;
  };
  featured?: boolean;
}
