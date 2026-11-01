# ADR 015: Validate recordings outside the UI thread

Status: accepted.

A desktop profile found a long blocking task while loading recording data. Large recordings must remain fully validated against the shared contract without freezing playback controls.

A dedicated Web Worker fetches and validates the manifest or recording, then returns validated JSON text. The UI parses that text and presents the actual frames. Validation errors remain visible; no replacement measurements are generated. The worker is terminated after completion or timeout. This preserves schema checks and moves bulk validation away from rendering.

The bundled Latin variable font is served locally under its SIL Open Font License. Public playback selects captures by date, newest first, rather than selecting favourable metrics. All archived runs remain accessible.
