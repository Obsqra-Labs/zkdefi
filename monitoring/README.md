# Monitoring

Prometheus alert rules and Grafana dashboard for zkde.fi reputation proof metrics.

---

## Index

| File | Purpose |
|------|---------|
| **alert_rules.yml** | Prometheus alert rules: HighProofFailureRate (>10% failure over 5m), SlowProofGeneration (P95 >30s for 10m). |
| **grafana_reputation_dashboard.json** | Dashboard: proof generation rate, success rate, P95 duration. Import via Grafana UI or [scripts/import_grafana_dashboard.sh](../scripts/README.md). |
| **prometheus.example.yml** | Example Prometheus config: `rule_files` + scrape for backend `:8003/metrics`. |

---

## Setup

1. **Prometheus** — Add to `prometheus.yml`:
   ```yaml
   rule_files:
     - "/path/to/zkdefi/monitoring/alert_rules.yml"
   ```
   Scrape backend: `http://127.0.0.1:8003/metrics`.

2. **Grafana** — Import `grafana_reputation_dashboard.json` (Create → Import). Panels use `proof_generation_total` and `proof_generation_duration_seconds_bucket`.

3. **Metrics** — Backend exposes `/metrics` (Prometheus client). Circuit scanner and reputation API record `proof_generation_total` and `proof_generation_duration_seconds` when metrics are available.
