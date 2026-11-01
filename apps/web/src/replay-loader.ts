export function loadReplayData<T>(url: string, kind: 'index' | 'recording'): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./replay-worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error('Recording validation timed out'));
    }, 30000);
    const close = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<{ json?: string; error?: string }>) => {
      close();
      if (event.data.error) reject(Error(event.data.error));
      else {
        try {
          resolve(JSON.parse(event.data.json!) as T);
        } catch {
          reject(Error('Recording validation failed'));
        }
      }
    };
    worker.onerror = () => {
      close();
      reject(Error('Recording worker unavailable'));
    };
    worker.postMessage({ url, kind });
  });
}
