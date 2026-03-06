# Monitoring

## Prometheus

Add to `prometheus.yml`:

```yaml
rule_files:
  - "/opt/obsqra.starknet/zkdefi/monitoring/alert_rules.yml"
```

Restart Prometheus after changing config.

## Grafana

Import `grafana_reputation_dashboard.json` via Create → Import. Select Prometheus as data source. Panels use `proof_generation_total` and `proof_generation_duration_seconds_bucket`.

## Alert rules

`alert_rules.yml` defines:

- **HighProofFailureRate**: >10% of proofs failing over 5m
- **SlowProofGeneration**: P95 proof duration >30s for 10m

## Alert rules

`alert_rules.yml` defines:

- **HighProofFailureRate**: >10% of proofs failing over 5m
- **SlowProofGeneration**: P95 proof duration >30s for 10m

PoseidonBridgeDown (plan) is omitted; it would require a `log_messages` metric from the app.

## Prometheus config (example)

Use `prometheus.example.yml` to load alert rules and scrape the backend:

```bash
cd monitoring && prometheus --config.file=prometheus.example.yml
```

Or merge its `rule_files` and `scrape_configs` into your existing `prometheus.yml`.

## Grafana dashboard import (optional)

To import the reputation dashboard via API (e.g. in CI or headless):

```bash
export GRAFANA_URL=http://localhost:3001
export GRAFANA_API_KEY=your-api-key
./scripts/import_grafana_dashboard.sh
```

Or use GRAFANA_USER and GRAFANA_PASSWORD for basic auth. Otherwise import `grafana_reputation_dashboard.json` manually via Create → Import.
