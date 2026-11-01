import { Recording, RecordingIndex } from '../../../packages/common/src/recordings';

globalThis.onmessage = async (
  event: MessageEvent<{ url: string; kind: 'index' | 'recording' }>,
) => {
  try {
    const response = await fetch(event.data.url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('Recording file unavailable');
    const input = await response.json();
    const parsed =
      event.data.kind === 'index' ? RecordingIndex.parse(input) : Recording.parse(input);
    // A string avoids a large object-graph clone on the UI thread. Validation stays off-thread.
    globalThis.postMessage({ json: JSON.stringify(parsed) });
  } catch (error) {
    globalThis.postMessage({ error: (error as Error).message });
  }
};
