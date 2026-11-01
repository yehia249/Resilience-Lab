# ADR 004: Custom rolling circuit breaker

Status: accepted for implementation; verification is tracked in STATUS.md.

## Decision

Open at a failure fraction >= 0.5 in the last 20 calls, with at least 10 samples. Wait 10 seconds; permit 3 half-open probes and close after 2 successes.

## Reason

This explicit state machine is small enough to test and explain. Transport failures count; business declines do not throw.

## Consequences

Windows are per gateway replica. Thresholds are initial policy, not benchmark-derived optima. Stale concurrent completions cannot overwrite a newer state generation.
