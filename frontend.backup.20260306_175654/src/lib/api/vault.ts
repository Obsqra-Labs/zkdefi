import { apiUrl } from "@/lib/api/client";

interface OperatorAddressResponse {
  operator_address?: string;
  detail?: string;
}

export async function getOperatorAddress(): Promise<OperatorAddressResponse> {
  const response = await fetch(apiUrl("/api/v1/vault/operator-address"), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : `Operator address request failed (${response.status})`;
    throw new Error(detail);
  }

  return (await response.json()) as OperatorAddressResponse;
}
