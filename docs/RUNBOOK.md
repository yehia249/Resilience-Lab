# Operations runbook

## Start locally

Run `make dev` in Linux/WSL with Docker active. On this workstation use `wsl -d ResilienceLab --cd 'F:\resilience lab' -- make dev`. Open http://localhost:8088. The Vite source preview is http://localhost:5173 and proxies to local services. `make test` runs lint, strict typechecking, unit tests and the frontend build. `make smoke` verifies products, cart, checkout idempotency and telemetry.

## Diagnose

Use `docker compose ps`, `docker compose logs --tail 100 SERVICE` or `kubectl -n lab get pods,hpa,events` and `kubectl -n lab-payment get pods,hpa,events`. Read service /healthz, /readyz and /metrics internally. Read `/v1/snapshot` through the web origin for measured status. Missing telemetry stays null, and does not mean zero latency, zero errors or healthy pods.

If payment is killed in Compose, the development adapter starts it again after a deliberate 12-second hold. This makes the local fault observable and is not a measured pod-scheduling delay. Production actually deletes payment pods and relies on Kubernetes reconciliation. The breaker closes after half-open probes; the worker may continue settling queued orders after the UI reports a healthy system.

Fault flags expire automatically. Emergency stop: set CHAOS_ENABLED=false and roll out chaos-controller and telemetry-api. Emergency clear is internal POST /v1/faults/clear with x-admin-token. Never expose that admin token to the browser. Do not clear Redis wholesale: carts, streams and idempotent recovery coordination would be lost.

## Queues and persistence

Observe orders_queue_depth and orders_queue_oldest_age_seconds. orders.dead contains exhausted entries for manual investigation. Never replay a charge with a new idempotency key. SQL pending-order reconciliation can republish stream messages; the worker checks durable order status before charging. Database backup/restore must be tested before claiming durability beyond the single host. No off-host backup currently exists.

## Rollback and shutdown

`kubectl rollout undo deployment/gateway -n lab` restores its previous revision; use the same for affected apps, including payment in lab-payment. A database schema migration needs separate compatibility review; rolling back an image does not roll back data. `docker compose stop` preserves local volumes. `make k3d-down` removes the named disposable development cluster. No cloud resources are provisioned. Local volume deletion is destructive and is never part of normal shutdown.
