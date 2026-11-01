# ADR 012: GitHub Pages with recorded replay

Status: accepted; supersedes VM hosting.

Pages hosts the static React frontend. Replay is the public default and loads actual captured JSON. Fault buttons select matching recordings; capture date and replay status remain visible. Checkout shows a captured outcome rather than pretending to submit an order.

Live mode connects to the local backend. Pages contains no secrets or external backend dependency. Hash routing and the repository base path support reloads. A browser test checks fault selection, accessibility and absence of backend requests in replay.
