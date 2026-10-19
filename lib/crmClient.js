// Talks to the deployed CRM exactly like a logged-in browser would:
// Firebase email/password -> idToken -> POST /api/auth/login -> `session` cookie.
// Every data call sends that cookie; a 401 triggers one re-login + retry.

const IDENTITY_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const REQUEST_TIMEOUT_MS = 60_000;

function withTimeout(ms) {
  return AbortSignal.timeout(ms);
}

function readSessionCookie(res) {
  const all = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  for (const line of all) {
    const m = /(?:^|,\s*)session=([^;]+)/.exec(line);
    if (m) return m[1];
  }
  return null;
}

export function createCrmClient({ baseUrl, apiKey, email, password }) {
  let session = null;
  let idToken = null;
  let loginPromise = null;

  async function firebaseSignIn() {
    const res = await fetch(`${IDENTITY_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: withTimeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.idToken) {
      throw new Error(`Firebase sign-in failed: ${json?.error?.message || res.status}`);
    }
    idToken = json.idToken;
  }

  async function doLogin() {
    await firebaseSignIn();
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: withTimeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`CRM login failed (${res.status}): ${body?.error || 'unknown error'}`);
    }
    const cookie = readSessionCookie(res);
    if (!cookie) throw new Error('CRM login succeeded but no session cookie was returned');
    session = cookie;
  }

  // Concurrent callers share one in-flight login.
  function login() {
    if (!loginPromise) {
      loginPromise = doLogin().finally(() => { loginPromise = null; });
    }
    return loginPromise;
  }

  async function request(path, accept, { retried = false, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!session) await login();
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Cookie: `session=${session}`, Accept: accept },
      cache: 'no-store',
      signal: withTimeout(timeoutMs),
    });
    if (res.status === 401 && !retried) {
      session = null;
      await login();
      return request(path, accept, { retried: true, timeoutMs });
    }
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res;
  }

  const getJson = async (path, options) => (await request(path, 'application/json', options)).json();
  /** A CRM page's HTML (the Purchase MIS page frames hr-erp's report with a token signed for this login). */
  const getText = async (path, options) => (await request(path, 'text/html', options)).text();
  /** Sign in again: a page answers an unknown session with the login page, not a 401. */
  const relogin = () => {
    session = null;
    return login();
  };

  return { login, getJson, getText, relogin };
}
