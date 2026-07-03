# Logging and Observability Guide

Use this guide with `rules.md` §15, §22, and §23 to keep runtime diagnostics useful, low-noise, and safe.

## Goals

- Make production behavior understandable without emergency code changes
- Keep logs machine-parseable and safe for centralized search
- Track the minimum metrics needed to detect regressions and incidents
- Ensure alerts are actionable instead of noisy

## Logging Baseline

### Required Fields

For operationally important services, include these fields in every structured log event where applicable:

- `timestamp`
- `level`
- `service`
- `component`
- `message`
- `correlation_id` or `trace_id`
- `environment`

Optional but useful fields:

- `user_id_hash`
- `request_path`
- `operation`
- `duration_ms`
- `error_code`

### Level Guidance

- `debug`: diagnostic details useful in development or targeted incident work
- `info`: normal business or workflow events
- `warning`: degraded behavior, retries, fallback use, or suspicious but recoverable states
- `error`: failed operations requiring investigation
- `critical`: system-wide failures, data loss risk, security incidents, or outages

### Redaction Rules

Never log:

- secrets, tokens, or credentials
- raw passwords
- full payment data
- raw personal data unless there is a documented, approved reason

Prefer:

- hashes or irreversible identifiers
- counts, categories, and coarse summaries
- allowlisted context fields instead of dumping full request payloads

## Metrics Baseline

Track these four categories when the system is production-facing or operationally significant:

- latency
- throughput
- error rate
- saturation or resource pressure

Examples:

- API p95 latency
- queue depth
- job success rate
- memory usage and CPU pressure

## Tracing and Correlation

- Propagate a `correlation_id` or `trace_id` across service boundaries.
- Include that identifier in logs, metrics dimensions where appropriate, and user-visible support references if safe.
- Prefer one identifier per request flow rather than generating unrelated IDs in every layer.

## Alerting Guidance

Good alerts are:

- tied to user impact or SLO drift
- routed to someone who can act
- specific about scope, service, and threshold
- quiet during expected maintenance windows

Bad alerts are:

- low-signal one-off errors
- alerts with no ownership
- alerts that require manual log spelunking just to understand what broke

## Review Checklist

Before calling logging or observability work done, confirm:

- logs are structured and field names are stable
- secrets and sensitive values are redacted
- correlation IDs exist where request tracing matters
- latency, throughput, error, and saturation metrics are defined
- alerts are actionable and not duplicative
- dashboards or runbooks are documented for critical services

## Related Files

- `rules.md`
- `GLOSSARY.md`
- `templates/github-actions/ai-rules-checks.yml`
- `templates/pre-commit/pre-commit.sample`
