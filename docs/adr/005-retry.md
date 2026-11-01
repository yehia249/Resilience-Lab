# ADR 005: Timeouts and full jitter

Status: accepted for implementation; verification is tracked in STATUS.md.

## Decision

Use explicit downstream timeouts, at most 2 read retries and 1 keyed payment retry, exponential full jitter with a 100-ms base.

## Reason

Retries can amplify failures; payment retries need persistent idempotency. The bulkhead bounds outstanding work.

## Consequences

Checkout may queue after failures before the breaker opens. Payment decline is not retried as a transport failure.
