import { useEffect, useRef, useState } from 'react';
import {
  Recording,
  RecordingIndex,
  type RecordingSummary,
} from '../../../packages/common/src/recordings';
import type { FaultType } from '../../../packages/common/src/schemas';
const base = import.meta.env.BASE_URL;
export function useReplay(enabled: boolean) {
  const [index, setIndex] = useState<RecordingIndex | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const cycles = useRef<Record<string, number>>({});
  async function open(summary: RecordingSummary, play: boolean) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(base + summary.file);
      if (!response.ok) throw Error('Recording file unavailable');
      const data = Recording.parse(await response.json());
      setRecording(data);
      setPosition(0);
      setPlaying(play);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!enabled) {
      setPlaying(false);
      return;
    }
    let active = true;
    void fetch(base + 'recordings/index.json')
      .then((r) => {
        if (!r.ok) throw Error('Real recordings are still being captured');
        return r.json();
      })
      .then((data) => {
        const parsed = RecordingIndex.parse(data);
        if (!active) return;
        setIndex(parsed);
        if (parsed.runs[0]) void open(parsed.runs[0], false);
        else setError('Real recordings are still being captured. No sample data is generated.');
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !playing || !recording) return;
    const next = recording.frames[position + 1];
    if (!next) {
      setPlaying(false);
      return;
    }
    const ms = Math.max(20, (next.ts - recording.frames[position].ts) / speed);
    const timer = setTimeout(() => setPosition((v) => v + 1), ms);
    return () => clearTimeout(timer);
  }, [enabled, playing, recording, position, speed]);
  async function selectFault(type: FaultType) {
    const runs = index?.runs.filter((r) => r.type === type) ?? [];
    if (!runs.length) {
      setError('This fault has no published real recording yet. Capture is still running.');
      return;
    }
    const count = cycles.current[type] ?? 0;
    cycles.current[type] = count + 1;
    await open(runs[count % runs.length], true);
  }
  function seekCheckout() {
    if (!recording) return null;
    const now = recording.frames[position].ts;
    const checkout =
      recording.checkouts.filter((c) => c.ts <= now).at(-1) ?? recording.checkouts[0];
    if (checkout) {
      const i = recording.frames.findIndex((f) => f.ts >= checkout.ts);
      if (i >= 0) setPosition(i);
      setPlaying(false);
    }
    return checkout ?? null;
  }
  const frame = recording?.frames[position] ?? null;
  const history =
    recording && frame
      ? recording.frames.slice(0, position + 1).filter((f) => f.ts >= frame.ts - 30000)
      : [];
  return {
    index,
    recording,
    frame,
    history,
    position,
    playing,
    speed,
    error,
    loading,
    selectFault,
    seekCheckout,
    setSpeed,
    toggle: () => setPlaying((v) => !v),
    restart: () => {
      setPosition(0);
      setPlaying(true);
    },
  };
}
