# Threat model

Assets are durable local orders, generated admin/internal tokens, workstation resources, repository provenance and recording integrity. Public Pages visitors download static assets; they have no route to the local backend and cannot inject faults or submit orders.

Live chaos input is a strict zod enum. Redis Lua reserves one global slot, checks cooldown and increments a hashed visitor quota. Flags expire. Kubernetes deletes are isolated to payment pods through a narrowly scoped adapter in the payment namespace. The development Compose adapter holds the Docker socket, which grants host-level power; it is bound only to the private Compose network and is never included in the public site.

IP identity uses HMAC with daily rotation and expiring keys. Raw visitor IPs are not logged. The proxy overwrites forwarded-IP headers; the gateway trusts one proxy hop. Anonymous HTTP rate limits do not replace authentication.

Requests have body limits, schema validation and timeouts. Bulkheads bound concurrency; synthetic traffic and SSE clients are capped. SQL is parameterized. Admin clear uses constant-time token comparison and is not routed through the gateway. CORS restricts origins but is not an authentication boundary.

Application containers run non-root with dropped capabilities, no privilege escalation and read-only roots. Required database/runtime paths remain writable. Default-deny Kubernetes network policies allow explicit service flows. Single-node exhaustion or host compromise is outside application recovery capability.

Secrets are generated into ignored .env and local Kubernetes Secrets. No cloud credentials, SSH deployment keys or Terraform state are required. Public captures allowlist normalized trace fields and contain synthetic shop data; they exclude raw tags, tokens and payment details.

CI checks dependencies, secrets and container vulnerabilities. Exact package versions and the lockfile are committed. Upstream image tags and most action major tags are update boundaries, not immutable artifact pins. Scan results can change as new vulnerabilities are published.
