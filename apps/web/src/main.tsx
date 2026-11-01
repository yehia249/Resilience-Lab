import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Cart as CartSchema,
  Snapshot as SnapshotSchema,
  Product as ProductSchema,
  CheckoutResponse,
  FaultType,
  BenchmarkResults,
  type Snapshot,
  type Product,
  type LabMetrics,
} from '../../../packages/common/src/schemas';
import './style.css';
const API = import.meta.env.VITE_API_URL ?? '';
const repo = 'https://github.com/yehia249/Resilience-Lab';
function saved(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage is optional */
  }
}
const cartId = saved('lab.cart') ?? crypto.randomUUID();
save('lab.cart', cartId);
const format = (n: number | null | undefined, suffix = '', digits = 0) =>
  n == null ? '—' : `${n.toFixed(digits)}${suffix}`;
async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-cart-id': cartId, ...options.headers },
    signal: AbortSignal.timeout(10000),
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw Error(
      typeof data === 'object' && data && 'error' in data
        ? String(data.error)
        : `Request failed (${response.status})`,
    );
  return data;
}
type Sample = LabMetrics & { ts: number; fault: boolean };
const faults: { type: FaultType; name: string; description: string; symbol: string }[] = [
  {
    type: 'KILL_PAYMENT',
    name: 'Kill payment service',
    description: 'Stop payment instances. Watch the circuit open.',
    symbol: '⏻',
  },
  {
    type: 'ADD_CATALOG_LATENCY',
    name: 'Add latency',
    description: 'Catalog takes an extra 300–500 ms for 30 s.',
    symbol: '◷',
  },
  {
    type: 'SPIKE_TRAFFIC',
    name: 'Spike traffic',
    description: '5× synthetic traffic for 60 s. Watch replicas.',
    symbol: '↗',
  },
  {
    type: 'SLOW_DATABASE',
    name: 'Slow database',
    description: 'Add 250 ms to catalog and payment queries.',
    symbol: '▤',
  },
];
function Chart({ samples }: { samples: Sample[] }) {
  const lines = [
    { key: 'p95' as const, color: 'var(--cyan)', label: 'p95 latency', unit: 'ms' },
    { key: 'errorRatePct' as const, color: 'var(--red)', label: 'error rate', unit: '%' },
    { key: 'rps' as const, color: 'var(--amber)', label: 'requests/s', unit: 'rps' },
  ];
  const end = samples.at(-1)?.ts ?? Date.now();
  return (
    <>
      <div className="chart">
        <svg
          viewBox="0 0 660 170"
          role="img"
          aria-label="Last 30 seconds of measured p95 latency, errors and requests per second, normalized separately"
        >
          <defs>
            <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--cyan)" stopOpacity=".12" />
              <stop offset="1" stopColor="var(--cyan)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[20, 60, 100, 140].map((y) => (
            <line key={y} x1="0" y1={y} x2="660" y2={y} className="grid-line" />
          ))}
          {samples
            .filter((s, i) => s.fault && !samples[i - 1]?.fault)
            .map((s) => (
              <line
                key={s.ts}
                x1={660 - ((end - s.ts) / 30000) * 660}
                x2={660 - ((end - s.ts) / 30000) * 660}
                y1="0"
                y2="150"
                className="fault-marker"
              />
            ))}
          {lines.map((l) => {
            const max = Math.max(
              l.key === 'p95' ? 250 : l.key === 'errorRatePct' ? 2 : 25,
              ...samples.map((s) => s[l.key] ?? 0),
            );
            const points = samples
              .filter((s) => s[l.key] !== null)
              .map(
                (s) =>
                  `${660 - ((end - s.ts) / 30000) * 660},${145 - ((s[l.key] ?? 0) / max) * 125}`,
              )
              .join(' ');
            return (
              <polyline key={l.key} fill="none" stroke={l.color} strokeWidth="2" points={points} />
            );
          })}
          <text x="0" y="166">
            −30 s
          </text>
          <text x="630" y="166">
            now
          </text>
        </svg>
        {!samples.some((s) => s.p95 !== null) && (
          <div className="chart-empty">Waiting for measured traffic</div>
        )}
      </div>
      <div className="legend">
        {lines.map((l) => (
          <span key={l.key}>
            <i style={{ background: l.color }} />
            {l.label}{' '}
            <b>
              {format(
                samples.at(-1)?.[l.key],
                l.unit === 'ms' ? ' ms' : l.unit === '%' ? '%' : '',
                l.key === 'errorRatePct' ? 1 : 0,
              )}
            </b>
          </span>
        ))}
      </div>
      <p className="micro">
        Each series uses its own scale. Values above are measured, never generated.
      </p>
    </>
  );
}
function App() {
  const [theme, setTheme] = useState(saved('lab.theme') ?? 'system');
  const [tour, setTour] = useState(saved('lab.tour') !== 'hidden');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [connected, setConnected] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [faultBusy, setFaultBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [bench, setBench] = useState<ReturnType<typeof BenchmarkResults.parse> | null>(null);
  const [path, setPath] = useState(location.pathname);
  const checkoutKey = useRef(crypto.randomUUID());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    save('lab.theme', theme);
  }, [theme]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    const pop = () => setPath(location.pathname);
    window.addEventListener('popstate', pop);
    return () => {
      clearInterval(id);
      window.removeEventListener('popstate', pop);
    };
  }, []);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void api('/api/cart')
      .then((data) => {
        const current = CartSchema.parse(data);
        if (active)
          setCart(Object.fromEntries(current.items.map((i) => [i.productId, i.quantity])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [connected]);
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let attempts = 0;
    const connect = () => {
      source = new EventSource(API + '/v1/stream');
      source.addEventListener('snapshot', (event) => {
        try {
          const s = SnapshotSchema.parse(JSON.parse((event as MessageEvent).data));
          setSnapshot(s);
          setConnected(true);
          attempts = 0;
          setSamples((old) => [
            ...old.filter((v) => v.ts > s.ts - 30000),
            { ...s.metrics, ts: s.ts, fault: !!s.fault },
          ]);
        } catch {
          setConnected(false);
        }
      });
      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!stopped) timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts++));
      };
    };
    connect();
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = ProductSchema.array().parse(await api('/api/products'));
        if (active) setProducts(data);
      } catch {
        /* Offline view remains useful. */
      }
      try {
        const result = BenchmarkResults.parse(await api('/v1/benchmarks'));
        if (active) {
          setBench(result);
          if (result.status === 'measured') save('lab.bench', JSON.stringify(result));
        }
      } catch {
        try {
          if (active) setBench(BenchmarkResults.parse(JSON.parse(saved('lab.bench') ?? 'null')));
        } catch {
          /* no saved measurements */
        }
      }
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  function navigate(to: string) {
    history.pushState({}, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }
  async function add(p: Product) {
    setBusy(true);
    try {
      const next = { ...cart, [p.id]: Math.min(20, (cart[p.id] ?? 0) + 1) };
      await api('/api/cart', {
        method: 'PUT',
        body: JSON.stringify({
          items: Object.entries(next).map(([productId, quantity]) => ({ productId, quantity })),
        }),
      });
      setCart(next);
      setMessage(`${p.name} added`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function checkout() {
    setBusy(true);
    setMessage('Checking out…');
    try {
      const r = CheckoutResponse.parse(
        await api('/api/checkout', {
          method: 'POST',
          headers: { 'idempotency-key': checkoutKey.current },
          body: JSON.stringify({ cartId }),
        }),
      );
      setMessage(
        r.status === 'confirmed'
          ? `Confirmed in ${r.latencyMs.toFixed(0)} ms · ${r.attempts} payment attempt(s)`
          : r.status === 'queued'
            ? `Order queued safely in ${r.latencyMs.toFixed(0)} ms. Payment is unavailable; the worker will settle it after recovery.`
            : `Payment failed after ${r.attempts} attempt(s). Your cart is still available.`,
      );
      if (r.status !== 'failed') {
        setCart({});
      }
      checkoutKey.current = crypto.randomUUID();
    } catch (e) {
      setMessage((e as Error).message + ' · You can retry safely.');
    } finally {
      setBusy(false);
    }
  }
  async function inject(type: FaultType) {
    setFaultBusy(true);
    try {
      await api('/api/chaos', { method: 'POST', body: JSON.stringify({ type }) });
      setMessage('Fault accepted. Watch the live dashboard.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setFaultBusy(false);
    }
  }
  const fault = snapshot?.fault;
  const cooldown = Math.max(0, Math.ceil(((snapshot?.cooldownUntil ?? 0) - now) / 1000));
  const remaining = fault ? Math.max(0, Math.ceil((fault.expiresAt - now) / 1000)) : 0;
  const disabledReason = !connected
    ? 'Backend disconnected — reconnecting'
    : snapshot?.chaosEnabled === false
      ? 'Chaos is disabled by the operator'
      : fault
        ? `A visitor is running ${fault.type.toLowerCase().replaceAll('_', ' ')} · ${remaining} s remaining`
        : cooldown
          ? `Cooling down · ${cooldown} s remaining`
          : faultBusy
            ? 'Sending fault request…'
            : '';
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const recovered = snapshot?.events.find((e) => e.kind === 'recovered');
  return (
    <div className="shell">
      <header>
        <div className="brand-row">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <span className="brand-mark">
              r<span>↗</span>
            </span>{' '}
            RESILIENCE LAB
          </a>
          <nav aria-label="Main navigation">
            <a
              href="/"
              aria-current={path === '/' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/');
              }}
            >
              The lab
            </a>
            <a
              href="/engineering"
              aria-current={path === '/engineering' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate('/engineering');
              }}
            >
              Engineering <span>↗</span>
            </a>
            <button
              className="theme"
              onClick={() =>
                setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')
              }
              aria-label={`Color theme: ${theme}. Change theme`}
            >
              {theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'}
            </button>
          </nav>
        </div>
        <div className="hero">
          <div>
            <div className="eyebrow">A LIVE SYSTEM. A LITTLE CONTROLLED CHAOS.</div>
            <h1>
              Break something.
              <br />
              <span>Watch it recover.</span>
            </h1>
            <p>
              A small shop running on a system you’re allowed to break.
              <br className="desktop" /> Inject a fault, follow the request, see resilience in
              action.
            </p>
          </div>
          <div className={'connection ' + (connected ? 'online' : '')}>
            <span className="pulse" />
            {connected ? 'SYSTEM CONNECTED' : 'BACKEND OFFLINE'}
            <small>
              {connected ? 'Live infrastructure · 1 s updates' : 'Waiting for real infrastructure'}
            </small>
          </div>
        </div>
      </header>
      {path === '/engineering' ? (
        <Engineering snapshot={snapshot} bench={bench} />
      ) : (
        <>
          {tour && (
            <aside className="tour">
              <span className="tour-number">02:00</span>
              <p>
                <strong>Your two-minute experiment</strong>
                <br />
                Kill payment → try Checkout → watch the circuit breaker → see the order recover.
              </p>
              <button
                onClick={() => {
                  setTour(false);
                  save('lab.tour', 'hidden');
                }}
                aria-label="Dismiss tour"
              >
                ×
              </button>
            </aside>
          )}
          {!connected && (
            <aside className="offline" role="status">
              <strong>
                {snapshot ? 'Connection lost. Reconnecting…' : 'The lab backend is offline.'}
              </strong>
              <span>
                {snapshot
                  ? 'Last received measurements remain visible.'
                  : 'No synthetic metrics are shown. The dashboard will connect automatically when the services start.'}
              </span>
              {bench?.status === 'measured' && (
                <span>
                  Saved benchmark: {bench.runs.length} measured fault runs · {bench.measuredAt}
                </span>
              )}
              <a
                href="/engineering"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/engineering');
                }}
              >
                View architecture & deployment status ↗
              </a>
            </aside>
          )}
          {recovered && (
            <div className="recovery" role="status" aria-live="polite">
              ✓ {recovered.message}
            </div>
          )}
          <main className="dashboard">
            <div className="main-column">
              <section className="card system">
                <div className="section-heading">
                  <h2>
                    <span className="section-index">01</span> System overview
                  </h2>
                  <span className="label">
                    {snapshot ? 'MEASURED TELEMETRY' : 'AWAITING TELEMETRY'}
                  </span>
                </div>
                <div className="stats">
                  {[
                    {
                      label: 'Requests / second',
                      value: format(snapshot?.metrics.rps),
                      unit: 'rps',
                    },
                    {
                      label: 'p95 latency',
                      value: format(snapshot?.metrics.p95),
                      unit: 'ms',
                      bad: (snapshot?.metrics.p95 ?? 0) > 250,
                    },
                    {
                      label: 'Error rate',
                      value: format(snapshot?.metrics.errorRatePct, '', 1),
                      unit: '%',
                      bad: (snapshot?.metrics.errorRatePct ?? 0) > 2,
                    },
                    {
                      label: 'Ready instances',
                      value: snapshot?.services.every((s) => s.ready !== null)
                        ? String(snapshot.services.reduce((a, s) => a + (s.ready ?? 0), 0))
                        : '—',
                      unit: 'pods / containers',
                    },
                  ].map((s) => (
                    <div className={'stat ' + (s.bad ? 'bad' : '')} key={s.label}>
                      <span>{s.label}</span>
                      <strong>
                        {s.value}
                        <small>{s.unit}</small>
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="service-map">
                  {(
                    snapshot?.services.filter((s) =>
                      ['gateway', 'catalog', 'cart', 'payment', 'postgres', 'redis'].includes(
                        s.name,
                      ),
                    ) ??
                    ['gateway', 'catalog', 'cart', 'payment', 'postgres', 'redis'].map((name) => ({
                      name,
                      ready: null,
                      desired: null,
                      cpuPct: null,
                      p95: null,
                      state: 'unknown',
                      memoryBytes: null,
                    }))
                  ).map((s) => (
                    <div key={s.name} className={'service ' + s.state}>
                      <div className="service-head">
                        <i />
                        {s.name}
                      </div>
                      <span className="service-latency">{format(s.p95, ' ms')}</span>
                      <div
                        className="dots"
                        role="img"
                        aria-label={`${s.ready ?? 'unknown'} of ${s.desired ?? 'unknown'} instances ready`}
                      >
                        {s.desired === null ? (
                          <span className="unknown">unavailable</span>
                        ) : (
                          Array.from({ length: Math.min(s.desired, 5) }, (_, i) => (
                            <i className={i < (s.ready ?? 0) ? 'ready' : ''} key={i} />
                          ))
                        )}
                      </div>
                      <div className="cpu">
                        <span style={{ width: `${Math.min(100, s.cpuPct ?? 0)}%` }} />
                      </div>
                      <span className="micro">
                        {s.name === 'payment'
                          ? `breaker: ${snapshot?.breaker ?? 'unknown'}`
                          : s.cpuPct === null
                            ? 'CPU unavailable'
                            : `${s.cpuPct.toFixed(1)}% of VM CPU`}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="system-note">
                  <span>
                    <i className="status-dot" />{' '}
                    {connected
                      ? 'Real requests. Real service responses.'
                      : 'Infrastructure status unavailable'}
                  </span>
                  <span>Gateway → services → data</span>
                </div>
              </section>
              <section className="card">
                <div className="section-heading">
                  <h2>
                    <span className="section-index">02</span> The last 30 seconds
                  </h2>
                  <span className="label">LIVE WINDOW</span>
                </div>
                <Chart samples={samples} />
              </section>
              <section className="card">
                <div className="section-heading">
                  <h2>
                    <span className="section-index">03</span> Follow a checkout
                  </h2>
                  <span className="label">LATEST REAL REQUEST</span>
                </div>
                <p className="card-description">Where one request spends its time.</p>
                {!snapshot?.trace.length ? (
                  <div className="empty-state">
                    <span>↳</span> Make a checkout to reveal its request waterfall.
                  </div>
                ) : (
                  <div className="waterfall">
                    {snapshot.trace.map((span, i) => (
                      <div className="water-row" key={span.service + i}>
                        <span>{span.service}</span>
                        <div className="track">
                          <i
                            className={span.error ? 'error' : ''}
                            style={{
                              marginLeft: `${(span.offsetMs / Math.max(...snapshot.trace.map((s) => s.offsetMs + s.durationMs), 1)) * 95}%`,
                              width: `${Math.max(1, (span.durationMs / Math.max(...snapshot.trace.map((s) => s.offsetMs + s.durationMs), 1)) * 95)}%`,
                            }}
                          />
                        </div>
                        <b>{span.skipped ? 'skipped' : format(span.durationMs, ' ms')}</b>
                      </div>
                    ))}
                  </div>
                )}
                <p className="micro">
                  Processor behavior is simulated. HTTP, persistence and elapsed times are real.
                </p>
              </section>
              <section className="card">
                <div className="section-heading">
                  <h2>Recent recoveries</h2>
                  <span className="label">LAST 20</span>
                </div>
                {snapshot?.recoveries.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Fault</th>
                          <th>Recovery</th>
                          <th>Peak p95</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.recoveries.map((r, i) => (
                          <tr key={r.created_at + i}>
                            <td>{r.fault_type.toLowerCase().replaceAll('_', ' ')}</td>
                            <td>{r.duration.toFixed(1)} s</td>
                            <td>{r.peak_p95.toFixed(0)} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-copy">
                    No measured recoveries yet. Run an experiment when the backend is connected.
                  </p>
                )}
              </section>
            </div>
            <aside className="side-column">
              <section className="card chaos">
                <div className="section-heading">
                  <h2>
                    <span className="section-index">↯</span> Break something
                  </h2>
                  <span className="badge">CONTROLLED</span>
                </div>
                <p className="card-description">One fault at a time. Every fault auto-reverts.</p>
                <div className="fault-grid">
                  {faults.map((f) => (
                    <button
                      className={'fault-button ' + (fault?.type === f.type ? 'active' : '')}
                      disabled={!!disabledReason}
                      key={f.type}
                      onClick={() => void inject(f.type)}
                    >
                      <span className="fault-icon">{f.symbol}</span>
                      <strong>{f.name}</strong>
                      <small>{f.description}</small>
                    </button>
                  ))}
                </div>
                <p className="fault-status" role="status">
                  <i className={'status-dot ' + (disabledReason ? 'muted' : '')} />
                  {disabledReason || 'Ready for your next experiment'}
                </p>
                <button
                  className="secondary full"
                  disabled={!connected}
                  onClick={() => {
                    setMessage(
                      'Faults expire automatically. Manual clear is restricted to the operator.',
                    );
                  }}
                >
                  How does recovery work? <span>↗</span>
                </button>
              </section>
              <section className="card shop">
                <div className="section-heading">
                  <h2>Try the shop</h2>
                  <span className="bag">{count} ITEMS</span>
                </div>
                <p className="card-description">A real cart. A simulated payment processor.</p>
                <div className="products">
                  {products.length ? (
                    products.slice(0, 3).map((p) => (
                      <button
                        disabled={busy || !connected}
                        key={p.id}
                        className="product"
                        onClick={() => void add(p)}
                      >
                        <span className="product-icon">{p.icon}</span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>${(p.price / 100).toFixed(2)}</small>
                        </span>
                        <span className="add">+</span>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state compact">
                      Products load from Postgres when connected.
                    </div>
                  )}
                </div>
                {products.length > 3 && (
                  <details>
                    <summary>Browse all {products.length} products</summary>
                    <div className="products">
                      {products.slice(3).map((p) => (
                        <button
                          disabled={busy || !connected}
                          key={p.id}
                          className="product"
                          onClick={() => void add(p)}
                        >
                          <span className="product-icon">{p.icon}</span>
                          <span>
                            <strong>{p.name}</strong>
                            <small>${(p.price / 100).toFixed(2)}</small>
                          </span>
                          <span className="add">+</span>
                        </button>
                      ))}
                    </div>
                  </details>
                )}
                <button
                  className="primary full"
                  disabled={busy || !count || !connected}
                  onClick={() => void checkout()}
                >
                  {busy ? 'Working…' : `Checkout (${count})`}
                  <span>→</span>
                </button>
                <p className="shop-result" role="status">
                  {message || 'No real money. No account. Just an experiment.'}
                </p>
              </section>
              <section className="card events">
                <div className="section-heading">
                  <h2>What the system is doing</h2>
                  <span className="live-dot" />
                </div>
                <div className="event-list" role="log" aria-live="polite" aria-relevant="additions">
                  {snapshot?.events.length ? (
                    snapshot.events.map((e, i) => (
                      <div className={'event ' + e.level} key={e.ts + e.kind + i}>
                        <time>
                          {new Date(e.ts).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false,
                          })}
                        </time>
                        <p>{e.message}</p>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">Events appear here as the live system reacts.</p>
                  )}
                </div>
              </section>
            </aside>
          </main>
        </>
      )}
      <footer>
        <span>
          <i className="status-dot" /> Built to fail. Designed to recover.
        </span>
        <a href={repo} target="_blank" rel="noreferrer">
          View source on GitHub ↗
        </a>
        <span>Single-node lab · honest limitations</span>
      </footer>
    </div>
  );
}
function Engineering({
  snapshot,
  bench,
}: {
  snapshot: Snapshot | null;
  bench: ReturnType<typeof BenchmarkResults.parse> | null;
}) {
  return (
    <main className="engineering">
      <section className="card">
        <div className="section-heading">
          <h2>Under the hood</h2>
          <a href={repo}>Source & documentation ↗</a>
        </div>
        <p>
          React streams measured telemetry over SSE. Fastify routes real shopping requests through a
          circuit breaker, retry budget and per-downstream bulkhead. Postgres persists orders and
          idempotent charges. Redis holds carts, bounded fault flags and the order stream.
        </p>
        <div
          className="architecture"
          role="img"
          aria-label="Browser connects to gateway and telemetry. Gateway calls catalog, cart and payment. Services use Postgres and Redis. Worker settles queued orders."
        >
          <div>Browser / React</div>
          <span>↓ HTTP + SSE</span>
          <div className="architecture-row">
            <div>
              Gateway
              <br />
              <small>breaker · retries · bulkhead</small>
            </div>
            <div>
              Telemetry API
              <br />
              <small>Prometheus · Jaeger · Kubernetes</small>
            </div>
          </div>
          <span>↓ W3C trace context</span>
          <div className="architecture-row">
            <div>Catalog</div>
            <div>Cart</div>
            <div>Payment</div>
            <div>Order worker</div>
          </div>
          <span>↓ durable state</span>
          <div className="architecture-row">
            <div>Postgres 16</div>
            <div>Redis 7 / Streams</div>
          </div>
        </div>
        <p>
          When payment fails, the order is persisted and queued. The worker retries with the same
          idempotency key, so a lost response cannot charge twice. Pending orders are reconciled
          from Postgres if stream publication fails.
        </p>
      </section>
      <div className="engineering-grid">
        <section className="card">
          <h2>Resource budget</h2>
          <p>
            Target: Oracle Always Free ARM, 2 OCPUs / 12 GB RAM. Live usage is unavailable until the
            cluster reports it.
          </p>
          {snapshot?.services.map((s) => (
            <div className="resource" key={s.name}>
              <b>{s.name}</b>
              <span>{format(s.cpuPct, '% CPU', 1)}</span>
              <span>
                {s.memoryBytes === null
                  ? '— memory'
                  : `${(s.memoryBytes / 1024 ** 2).toFixed(0)} MiB`}
              </span>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Measured benchmarks</h2>
          {bench?.status === 'measured' ? (
            <>
              <p>
                {bench.runs.length} runs measured at {bench.measuredAt}
              </p>
              {bench.runs.map((r, i) => (
                <div className="resource" key={i}>
                  <span>{r.type}</span>
                  <b>{r.duration.toFixed(1)} s</b>
                </div>
              ))}
            </>
          ) : (
            <p>
              No benchmark runs have been published. Recovery, throughput, HPA response and pod
              restart timings remain unmeasured.
            </p>
          )}
          <a href={repo + '/tree/main/docs/benchmarks'}>Method & raw results ↗</a>
        </section>
      </div>
      <section className="card">
        <h2>Engineering decisions</h2>
        <div className="decisions">
          {[
            [
              'Postgres + Redis',
              'Durable business records and idempotency in SQL; ephemeral carts and queue coordination in Redis.',
            ],
            [
              'k3s on a single node',
              'A small, inspectable Kubernetes control plane with real deployments and HPA, within the free resource budget.',
            ],
            [
              'SSE for telemetry',
              'One-way updates with browser-native reconnection; no WebSocket session protocol.',
            ],
            [
              'Circuit breaker',
              '20-call rolling window; at least 10 calls; open at 50% errors; three half-open probes after 10 seconds.',
            ],
            [
              'Bounded retries',
              'Full jitter and explicit timeouts. Payment retries require a durable idempotency key.',
            ],
            [
              'Fault safety',
              'One global slot, Redis-atomic quota, TTL, cooldown, kill switch and narrowly isolated fault adapters.',
            ],
            [
              'Observability',
              'Prometheus supplies rates and percentiles. OpenTelemetry propagates trace context. Missing values stay unavailable.',
            ],
            [
              'Autoscaling',
              'CPU-driven HPA with a fast scale-up and a slower scale-down window. Local Compose has no autoscaler.',
            ],
            [
              'Zero-dollar budget',
              'Infrastructure must be free-tier eligible; cloud apply requires an approved resource plan.',
            ],
            [
              'Single-node trade-offs',
              'A host failure takes down the lab. This demonstrates application recovery, not high availability.',
            ],
          ].map(([title, copy], i) => (
            <article key={title}>
              <span>ADR {String(i + 1).padStart(3, '0')}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>How this was built</h2>
        <p>
          TypeScript · React 18 · Fastify · Postgres 16 · Redis 7 · OpenTelemetry · Prometheus ·
          Jaeger · Docker · k3s · Kustomize · Terraform · GitHub Actions.
        </p>
        <h3>Honest limitations</h3>
        <p>
          The payment processor is simulated and no money moves. Database slowdown is an explicit
          delay in the query wrapper. Synthetic shoppers create real requests. CPU, replica and
          recovery figures only appear when the real infrastructure reports them. A single-node
          cluster cannot survive a host outage. The dashboard has no fake demo mode.
        </p>
        <h3>Demo recording</h3>
        <p>
          A recording has not been provided yet. The repository includes a 90-second recording
          script and click path. No placeholder video is presented as a working demo.
        </p>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
