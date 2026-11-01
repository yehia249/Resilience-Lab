# ADR 014: Acknowledge the kill before checking recovery

Status: accepted.

A local guardrail test exposed an ordering race: the fault was reserved before the adapter call completed, so the readiness monitor could observe the old healthy service and clear the fault prematurely.

Persist the current fault's acknowledgement only after the adapter confirms its kill request. Readiness-based clearance requires that acknowledgement. Kubernetes readiness is counted from Running, Ready pods that are not terminating, rather than the deployment's delayed aggregate status. Clearing atomically removes the fault, flag and acknowledgement and starts cooldown. The maximum TTL remains a fallback.

Integration checks exercise the real active-fault lock, Redis expiry, cooldown, queued checkout, worker settlement and replay. Historical captures retain their original measurements and limitations.
