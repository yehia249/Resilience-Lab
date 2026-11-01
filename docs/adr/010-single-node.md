# ADR 010: Single-node trade-offs

Status: accepted for implementation; verification is tracked in STATUS.md.

## Decision

Keep the complete lab on one host and explain the failure boundary.

## Reason

The project demonstrates backend fault handling at zero cost; production high availability is out of scope.

## Consequences

Disk/host/control-plane failure takes down all services. There is no verified off-host backup. Offline UI preserves honest status and measured benchmark evidence only when present.
