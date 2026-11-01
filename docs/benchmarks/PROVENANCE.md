# Capture provenance and interruptions

The JSON files contain actual snapshots, checkout results and normalized traces. The runtime Node version was read inside the Kubernetes telemetry deployment. Recorder revision identifies the tool source, not the source commit of a previously built runtime image.

The first four captures recorded the local Docker image identifier available to the initial recorder. Later captures read the running Kubernetes container's imageID directly. The first identifier is not independently verified against the pod's imageID, so it must not be used to assert an exact runtime artifact. This provenance limitation does not replace or change any captured metric.

The same existing local k3d deployment was used throughout the campaign. Infrastructure image updates were tested in a separate CI cluster. Application service faults, observed restarts and shared-host contention are part of the recorded experiments.

One spike attempt was interrupted by concurrent Compose build/start contention; see interrupted-build-contention.json. It predates automatic failed-frame persistence and is excluded from completed-run statistics. A later fixture quota reset encountered a transient WSL transport timeout before injecting a fault. The recorder resumed completed files and retried the missing experiment. New interrupted attempts preserve collected frames separately.

Success statistics describe completed recoveries only. They are not an experiment success-rate estimate. Sample p95 uses the nearest-rank estimator; with ten runs it is the largest observed recovery. One-second polling can miss a brief payment fault slot. For that case the accepted fault request and actual trace errors establish the experiment, without inserting synthetic snapshots.

The load-test workflow uses another real Docker Compose system inside an existing GitHub Actions runner. Its measurements have separate provenance and must not be described as workstation k3d throughput. Lighthouse measures the public static replay page, not backend performance.
