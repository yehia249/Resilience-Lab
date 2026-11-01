# ADR 012: Serve the frontend on the VM by default

Status: accepted for implementation; verification is tracked in STATUS.md.

## Decision

Use Nginx and Traefik to serve the frontend and same-origin API on a free hostname.

## Reason

The user has no Cloudflare account. The brief explicitly permits VM frontend fallback, so this avoids an extra personal signup.

## Consequences

Independent Pages hosting is documented but not claimed as tested. A VM outage also makes the VM-hosted UI unreachable; a separate static host would improve that boundary.
