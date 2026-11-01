# ADR 001: Postgres and Redis

Status: accepted for implementation; verification is tracked in STATUS.md.

## Decision

Use Postgres for durable products, orders, charge idempotency and recovery history; Redis for expiring carts, fault coordination and streams.

## Reason

A single datastore would simplify operations but SQL uniqueness and Redis TTL/stream primitives are both useful interview-visible mechanisms.

## Consequences

Two local data stores increase failure modes and memory use. SQL reconciliation repairs missed stream publications; there is no distributed transaction.
