# ADR 006: Bounded anonymous fault safety

Status: accepted for implementation; verification is tracked in STATUS.md.

## Decision

Use one Redis-atomic global slot, 15-second cooldown, 3-per-10-minute rotating-HMAC visitor quota, strict enum input, kill switch and expiring flags.

## Reason

Anonymous visitors must not inject arbitrary commands or overlap faults. Labels cannot constrain Kubernetes RBAC deletion.

## Consequences

Payment pods live in lab-payment. A fixed-function proxy holds namespaced delete permissions; the public chaos process has no delete token. Local Docker adapter is privileged through its socket and must remain internal.
