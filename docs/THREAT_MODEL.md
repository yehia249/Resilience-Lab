# Threat model

Assets: VM budget, durable order/payment records, admin and internal tokens, OCI credentials, container provenance and availability. Visitors are anonymous and may coordinate abusive requests. Synthetic shopper data contains no actual payment or identity details.

Chaos input is a strict zod enum. Atomic Redis Lua reserves one global slot, checks cooldown and increments a hashed visitor quota. Fault flags expire. Kills are bounded to payment containers/pods. A separate local adapter holds the Docker socket; it is never public and is development-only. Docker socket access is effectively host-root privilege: isolate that container and never deploy it to production. Kubernetes uses a payment-only namespace and proxy; namespace RBAC cannot enforce labels itself.

Raw visitor IPs are not logged. App rate-limit keys and chaos identity use HMAC with a secret and daily rotation. Keys expire. A reverse proxy overwrites the forwarded-IP header; the gateway trusts one proxy hop. Before exposure behind another proxy, explicitly configure and test the trusted chain. A compromised trusted proxy could defeat per-IP quotas. The one-global-fault limit and TTL still apply.

Service routes have body limits, input validation and request timeouts. Bulkheads bound outgoing concurrency. Synthetic traffic has an explicit hard request cap. SSE client count and write backlog are bounded. SQL uses parameters. Admin clear requires a constant-time token comparison and is not routed by the public gateway. CORS is origin-restricted; CORS is not an authentication boundary for anonymous HTTP clients.

Production pods run non-root, drop capabilities, disable privilege escalation, and use read-only roots where practical. Postgres's data/runtime paths are writable. Default-deny network policies allow required DNS, telemetry, database and application paths; API access is scoped to read-only telemetry and the payment kill proxy. Single-node compromise or VM exhaustion is outside application recovery capability.

Secrets are generated into ignored .env and Kubernetes Secrets, never source. Kubernetes secrets encryption is enabled in cloud-init. Terraform state and saved plans remain local and ignored. GitHub production and infrastructure environments must have manual approval rules configured by the owner. Deployment requires successful CI for the exact SHA, pinned SSH host keys, and rollback after failed smoke checks.

Supply chain: exact package versions, committed lockfile, dependency audit, Gitleaks, Trivy, Dependabot and multi-arch CI builds. Image tags are commit-specific for deployment. Container base tags and GitHub action major tags are update boundaries and are not immutable digest pins; pinning all upstream artifacts and signing image provenance remain hardening work unless verified in STATUS.md. An audit passing today does not guarantee absence of vulnerabilities.
