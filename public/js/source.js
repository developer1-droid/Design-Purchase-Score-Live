/* Where the scores come from: the Purchase & Design Live server (fetch + socket.io) or mock.json. */
import { mutateMock, padMock } from './mockDrift.js';

const MOCK_TICK_MS = 12000;

/** handlers: { onScores, onSettings, onConn } */
export function startLive({ onScores, onSettings, onConn }) {
  // cache: 'no-store' is ignored before Chrome 64, so old TVs also get a cache-busting query.
  fetch(`/api/scores?_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => { if (json) onScores(json); })
    .catch(() => { /* the socket delivers the first board */ });
  const script = document.createElement('script');
  script.src = '/socket.io/socket.io.js';
  script.onload = () => {
    const socket = window.io({ reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000 });
    socket.on('connect', () => onConn('live'));
    socket.on('disconnect', () => onConn('reconnecting'));
    socket.on('connect_error', () => onConn('reconnecting'));
    socket.io.on('reconnect_failed', () => onConn('offline'));
    socket.on('scores', onScores);
    socket.on('settings', onSettings);
  };
  script.onerror = () => onConn('offline');
  document.head.appendChild(script);
}

export function startMock({ onScores, onConn, padRows, still }) {
  let latest = null;
  fetch(`mock.json?_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((json) => {
      json.updatedAt = new Date().toISOString();
      latest = padMock(json, padRows);
      onScores(latest);
      if (still) return;
      setInterval(() => { latest = mutateMock(latest); onScores(latest); }, MOCK_TICK_MS);
    })
    .catch((err) => { console.error('[pd-live] mock.json failed', err); onConn('offline'); });
}
