# ADR 009: Always Free budget

Status: accepted for implementation; verification is tracked in STATUS.md.

## Decision

Fix the OCI VM at 2 OCPUs, 12 GB memory and a 50-GB boot volume, in the home region, with a saved resource plan and explicit first-apply approval.

## Reason

Current Oracle Always Free documentation is stricter than old 4/24 examples. A zero-dollar boundary prohibits opportunistic paid fallback.

## Consequences

Free-tier eligibility depends on tenancy-wide usage and provider policy. No guaranteed immunity from idle reclamation is claimed.
