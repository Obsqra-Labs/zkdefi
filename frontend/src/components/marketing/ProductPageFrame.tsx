"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { apiUrl } from "@/lib/api/client";
import { DEFAULT_DEMO_ADDRESS } from "@/lib/products/catalog";
import {
  ProductCategory,
  ProductDefinition,
  ProductStatus,
  SandboxAction,
} from "@/lib/products/types";

type SandboxPhase = "idle" | "running" | "success" | "error";

interface SandboxActionState {
  queryText: string;
  bodyText: string;
  phase: SandboxPhase;
  endpoint?: string;
  statusCode?: number;
  response?: unknown;
  error?: string;
  attempted: string[];
}

interface ProductStatusChipProps {
  status: ProductStatus;
}

interface ProductPageFrameProps {
  product: ProductDefinition;
  category: ProductCategory;
}

function ProductStatusChip({ status }: ProductStatusChipProps) {
  const isBuilt = status === "BUILT";
  const isReady = status === "READY";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        isBuilt
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : isReady
            ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
    >
      {status}
    </span>
  );
}

function replacePlaceholders<T>(value: T): T {
  if (typeof value === "string") {
    return value.replaceAll("__ADDRESS__", DEFAULT_DEMO_ADDRESS) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => replacePlaceholders(entry)) as T;
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = replacePlaceholders(item);
    }
    return next as T;
  }

  return value;
}

function toPrettyJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeEndpointCandidate(candidate: string): string {
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }

  if (candidate.startsWith("/")) {
    return candidate;
  }

  return `/${candidate}`;
}

function expandPrefixFallbackCandidates(candidate: string): string[] {
  if (/^https?:\/\//i.test(candidate)) {
    return [candidate];
  }

  const normalized = normalizeEndpointCandidate(candidate);
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length < 4 || segments[0] !== "api" || segments[1] !== "v1") {
    return [normalized];
  }

  const output: string[] = [normalized];

  // Handle /x and /x/x route prefix mismatch by trying duplicate mounts on the first route segments.
  for (const idx of [2, 3]) {
    if (idx >= segments.length) {
      continue;
    }

    const duplicated = [
      ...segments.slice(0, idx + 1),
      segments[idx],
      ...segments.slice(idx + 1),
    ];
    output.push(`/${duplicated.join("/")}`);
  }

  for (let idx = 2; idx < Math.min(segments.length - 1, 6); idx += 1) {
    if (segments[idx] === segments[idx + 1]) {
      const stripped = [...segments.slice(0, idx), ...segments.slice(idx + 1)];
      output.push(`/${stripped.join("/")}`);
    }
  }

  return [...new Set(output)];
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed;
}

function appendQuery(endpoint: string, query: Record<string, unknown>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "object") {
      params.set(key, JSON.stringify(value));
      continue;
    }

    params.set(key, String(value));
  }

  if ([...params.keys()].length === 0) {
    return endpoint;
  }

  if (/^https?:\/\//i.test(endpoint)) {
    const url = new URL(endpoint);
    params.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
    return url.toString();
  }

  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${params.toString()}`;
}

function defaultStateForAction(action: SandboxAction): SandboxActionState {
  const querySource = action.sampleQuery ? replacePlaceholders(action.sampleQuery) : {};
  const bodySource = action.sampleBody ? replacePlaceholders(action.sampleBody) : {};

  return {
    queryText: JSON.stringify(querySource, null, 2),
    bodyText: JSON.stringify(bodySource, null, 2),
    phase: "idle",
    attempted: [],
  };
}

export function ProductPageFrame({ product, category }: ProductPageFrameProps) {
  const initialState = useMemo(() => {
    return Object.fromEntries(
      product.standaloneActions.map((action) => [action.id, defaultStateForAction(action)]),
    ) as Record<string, SandboxActionState>;
  }, [product.standaloneActions]);

  const [actionStates, setActionStates] = useState<Record<string, SandboxActionState>>(initialState);

  useEffect(() => {
    setActionStates(initialState);
  }, [initialState]);

  const runAction = async (action: SandboxAction) => {
    const existing = actionStates[action.id] || defaultStateForAction(action);

    let queryObject: Record<string, unknown>;
    let bodyObject: Record<string, unknown>;

    try {
      queryObject = parseJsonObject(existing.queryText, "Query payload");
      bodyObject = parseJsonObject(existing.bodyText, "Request body");
    } catch (error) {
      setActionStates((prev) => ({
        ...prev,
        [action.id]: {
          ...existing,
          phase: "error",
          error: error instanceof Error ? error.message : "Invalid JSON input",
          attempted: [],
          response: null,
          statusCode: undefined,
          endpoint: undefined,
        },
      }));
      return;
    }

    const pathCandidates = action.endpointCandidates
      .map((path) => replacePlaceholders(path))
      .flatMap((path) => expandPrefixFallbackCandidates(path));

    const requestCandidates = [...new Set(pathCandidates)].map((path) => appendQuery(path, queryObject));

    setActionStates((prev) => ({
      ...prev,
      [action.id]: {
        ...existing,
        phase: "running",
        error: undefined,
        endpoint: undefined,
        statusCode: undefined,
        response: undefined,
        attempted: requestCandidates,
      },
    }));

    let lastError: {
      message: string;
      endpoint: string;
      statusCode?: number;
      payload?: unknown;
    } | null = null;

    for (const candidate of requestCandidates) {
      try {
        const response = await fetch(apiUrl(candidate), {
          method: action.method,
          headers: {
            "Content-Type": "application/json",
            ...(action.headers || {}),
          },
          body:
            action.method === "GET" || action.method === "DELETE"
              ? undefined
              : JSON.stringify(bodyObject),
        });

        const rawResponse = await response.text();
        let parsedResponse: unknown = rawResponse;

        if (rawResponse) {
          try {
            parsedResponse = JSON.parse(rawResponse);
          } catch {
            parsedResponse = rawResponse;
          }
        } else {
          parsedResponse = { ok: response.ok, empty: true };
        }

        if (response.ok) {
          setActionStates((prev) => ({
            ...prev,
            [action.id]: {
              ...prev[action.id],
              phase: "success",
              endpoint: candidate,
              statusCode: response.status,
              response: parsedResponse,
              error: undefined,
            },
          }));
          return;
        }

        lastError = {
          message: `Endpoint returned ${response.status}`,
          endpoint: candidate,
          statusCode: response.status,
          payload: parsedResponse,
        };

        if (response.status !== 404 && response.status !== 405) {
          break;
        }
      } catch (error) {
        lastError = {
          message: error instanceof Error ? error.message : "Network error",
          endpoint: candidate,
        };
      }
    }

    setActionStates((prev) => ({
      ...prev,
      [action.id]: {
        ...prev[action.id],
        phase: "error",
        endpoint: lastError?.endpoint,
        statusCode: lastError?.statusCode,
        error: lastError?.message || "All endpoint candidates failed",
        response: lastError?.payload,
      },
    }));
  };

  const runPrimaryDemo = () => {
    if (product.standaloneActions.length === 0) {
      return;
    }

    void runAction(product.standaloneActions[0]);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader compact />

      <section className="border-b border-zinc-800 px-6 pb-8 pt-12">
        <div className="mx-auto max-w-6xl">
          <Link
            href="/products"
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Products
          </Link>

          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
                {category.title}
              </div>
              <h1 className="mt-4 text-4xl font-bold tracking-tight">{product.title}</h1>
              <p className="mt-3 max-w-3xl text-lg text-zinc-300">{product.summary}</p>
            </div>
            <ProductStatusChip status={product.status} />
          </div>
        </div>
      </section>

      <section className="px-6 py-10">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
              <h2 className="mb-3 text-xl font-semibold">What it does</h2>
              <p className="leading-relaxed text-zinc-300">{product.description}</p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
              <h2 className="mb-4 text-xl font-semibold">Current capabilities</h2>
              <ul className="space-y-2">
                {product.capabilities.map((capability) => (
                  <li key={capability} className="text-sm leading-relaxed text-zinc-300">
                    • {capability}
                  </li>
                ))}
              </ul>
            </div>

            <div id="standalone" className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
              <div className="mb-4 flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-emerald-300" />
                <h2 className="text-xl font-semibold">Standalone API Sandbox</h2>
              </div>
              <p className="mb-6 text-sm text-zinc-400">
                Run direct API actions from this page. Endpoint fallback automatically tries both
                single-prefix and duplicated-prefix path variants.
              </p>

              <div className="space-y-5">
                {product.standaloneActions.map((action) => {
                  const state = actionStates[action.id] || defaultStateForAction(action);
                  const isRunning = state.phase === "running";
                  const isSuccess = state.phase === "success";
                  const isError = state.phase === "error";

                  return (
                    <div
                      key={action.id}
                      className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="mb-1 flex items-center gap-2">
                            <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold text-zinc-300">
                              {action.method}
                            </span>
                            <h3 className="text-sm font-semibold text-zinc-100">{action.title}</h3>
                          </div>
                          <p className="text-xs leading-relaxed text-zinc-400">{action.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void runAction(action)}
                          disabled={isRunning}
                          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRunning ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Running
                            </>
                          ) : (
                            <>
                              Run standalone demo
                              <ArrowRight className="h-3.5 w-3.5" />
                            </>
                          )}
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {action.endpointCandidates.map((candidate) => (
                          <code
                            key={candidate}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400"
                          >
                            {replacePlaceholders(candidate)}
                          </code>
                        ))}
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-zinc-500">Query JSON</label>
                          <textarea
                            value={state.queryText}
                            onChange={(event) => {
                              const value = event.target.value;
                              setActionStates((prev) => ({
                                ...prev,
                                [action.id]: {
                                  ...state,
                                  queryText: value,
                                },
                              }));
                            }}
                            className="h-28 w-full rounded-lg border border-zinc-700 bg-zinc-900/70 px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-colors focus:border-emerald-500"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-zinc-500">Body JSON</label>
                          <textarea
                            value={state.bodyText}
                            onChange={(event) => {
                              const value = event.target.value;
                              setActionStates((prev) => ({
                                ...prev,
                                [action.id]: {
                                  ...state,
                                  bodyText: value,
                                },
                              }));
                            }}
                            disabled={action.method === "GET" || action.method === "DELETE"}
                            className="h-28 w-full rounded-lg border border-zinc-700 bg-zinc-900/70 px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-colors focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                      </div>

                      {state.attempted.length > 0 && (
                        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Attempted endpoints</p>
                          <div className="mt-2 space-y-1">
                            {state.attempted.map((endpoint) => (
                              <code
                                key={endpoint}
                                className="block break-all text-[11px] text-zinc-400"
                              >
                                {endpoint}
                              </code>
                            ))}
                          </div>
                        </div>
                      )}

                      {(isRunning || isSuccess || isError) && (
                        <div
                          className={`mt-4 rounded-lg border p-3 ${
                            isSuccess
                              ? "border-emerald-500/40 bg-emerald-500/10"
                              : isError
                                ? "border-rose-500/40 bg-rose-500/10"
                                : "border-zinc-700 bg-zinc-900/40"
                          }`}
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                            {isRunning && (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-300" />
                                <span className="text-zinc-300">Running request...</span>
                              </>
                            )}
                            {isSuccess && (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                                <span className="text-emerald-200">Success</span>
                              </>
                            )}
                            {isError && (
                              <>
                                <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />
                                <span className="text-rose-200">
                                  Endpoint unavailable/error: {state.error || "Unknown error"}
                                </span>
                              </>
                            )}
                            {state.statusCode && (
                              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
                                {state.statusCode}
                              </span>
                            )}
                          </div>

                          {state.endpoint && (
                            <code className="mb-2 block break-all text-[11px] text-zinc-400">
                              {state.endpoint}
                            </code>
                          )}

                          {state.response !== undefined && (
                            <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/70 p-2 text-[11px] text-zinc-200">
                              {toPrettyJson(state.response)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h3 className="mb-3 text-sm uppercase tracking-wider text-zinc-500">Standalone demo</h3>
              <button
                type="button"
                onClick={runPrimaryDemo}
                disabled={product.standaloneActions.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-semibold transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Run standalone demo
                <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-3 text-xs text-zinc-500">
                Demo wallet: <span className="break-all">{DEFAULT_DEMO_ADDRESS}</span>
              </p>
            </div>

            {product.advancedLink && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <h3 className="mb-3 text-sm uppercase tracking-wider text-zinc-500">Advanced app</h3>
                <Link
                  href={product.advancedLink.href}
                  prefetch={false}
                  className="inline-flex items-center gap-2 text-sm text-zinc-200 transition-colors hover:text-white"
                >
                  {product.advancedLink.label}
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            )}

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h3 className="mb-3 text-sm uppercase tracking-wider text-zinc-500">References</h3>
              <Link
                href={product.docsHref}
                prefetch={false}
                className="inline-flex items-center gap-2 text-sm text-cyan-300 transition-colors hover:text-cyan-200"
              >
                Documentation
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
