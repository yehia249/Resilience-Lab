# ADR 011: Shared implementation, independent service processes

Status: accepted for implementation; verification is tracked in STATUS.md.

## Decision

Use apps/runtime for shared Fastify middleware and service implementations; SERVICE selects one role in each independently deployed process.

## Reason

Duplicated bootstraps and metric definitions drift easily in a small monorepo. One reviewed image keeps multi-arch delivery simpler.

## Consequences

This is not a single-process simulation. Network calls, database connections, process faults and per-replica breakers remain real. A shared image has a larger dependency surface than separate minimal images.
