import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModelComposer } from "./ModelComposer";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

function mockCommonResponses() {
  apiFetchMock.mockImplementation((url: string) => {
    if (url.includes("/agents/models/list")) {
      return Promise.resolve({
        models: [
          { id: "risk_scoring", name: "Risk Score", type: "groth16", timeout: 10 },
          { id: "correlation_risk", name: "Correlation Risk", type: "groth16", timeout: 10 },
        ],
      });
    }
    if (url.includes("/agents/providers")) {
      return Promise.resolve({
        providers: [
          {
            provider_id: "openai",
            name: "OpenAI",
            family: "openai",
            aliases: ["openai"],
            default_model: "gpt-4o-mini",
            models: ["gpt-4o-mini"],
            requires_api_key_env: true,
            requires_base_url: false,
            api_key_env: "OPENAI_API_KEY",
            defaults: { temperature: 0.2, max_tokens: 1024, top_p: 1 },
            config_requirements: {
              requires_api_key_env: true,
              requires_base_url: false,
              supports_temperature: true,
              supports_top_p: true,
              supports_max_tokens: true,
            },
          },
          {
            provider_id: "local",
            name: "Local",
            family: "local",
            aliases: ["local"],
            default_model: "llama3.1:8b",
            models: ["llama3.1:8b"],
            requires_api_key_env: false,
            requires_base_url: true,
            base_url: "http://localhost:11434/v1",
            defaults: { temperature: 0.2, max_tokens: 1024, top_p: 1 },
            config_requirements: {
              requires_api_key_env: false,
              requires_base_url: true,
              supports_temperature: true,
              supports_top_p: true,
              supports_max_tokens: true,
            },
          },
          {
            provider_id: "deterministic",
            name: "Deterministic",
            family: "deterministic",
            aliases: ["deterministic"],
            default_model: "deterministic-v1",
            models: ["deterministic-v1"],
            requires_api_key_env: false,
            requires_base_url: false,
            defaults: { temperature: 0, max_tokens: 512, top_p: 1 },
            config_requirements: {
              requires_api_key_env: false,
              requires_base_url: false,
              supports_temperature: true,
              supports_top_p: true,
              supports_max_tokens: true,
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

describe("ModelComposer", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    mockCommonResponses();
  });

  it("hydrates draft from Circuit Board into the composer flow", async () => {
    render(
      <ModelComposer
        userAddress="0xabc"
        draft={{
          name: "Draft Agent",
          processors: ["risk_scoring"],
          decisionLogic: "OR",
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("Draft Agent")).toBeTruthy();
    });

    expect(screen.getByText(/Create Composed Agent/i)).toBeTruthy();
    expect(screen.getAllByText("Risk Score").length).toBeGreaterThan(0);
    const logicText = screen.getByText(/Logic:/i);
    expect(logicText.textContent || "").toContain("OR");
  });

  it("renders provider-specific config requirements", async () => {
    render(
      <ModelComposer
        userAddress="0xabc"
        draft={{
          name: "Provider Agent",
          processors: ["risk_scoring"],
          decisionLogic: "AND",
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("Provider Agent")).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText("Provider")).toBeTruthy();
    });

    const providerSelect = screen.getAllByRole("combobox")[0];

    fireEvent.change(providerSelect, { target: { value: "local" } });
    expect(screen.getByText("Base URL")).toBeTruthy();
    expect(screen.queryByText("API Key Env Var")).toBeNull();

    fireEvent.change(providerSelect, { target: { value: "openai" } });
    expect(screen.getByText("API Key Env Var")).toBeTruthy();
    expect(screen.queryByText("Base URL")).toBeNull();
  });
});
