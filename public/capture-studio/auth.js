// Shared Capture Studio authentication; never log or embed credentials.
const STORAGE_KEY = 'hyperframes.renderApiToken.v1';

export function normalizeToken(value) {
  return String(value ?? '').trim().replace(/^Bearer\s+/i, '').trim();
}

export function validateToken(value) {
  const token = normalizeToken(value);
  if (!token) throw new Error('Enter the Render API token.');
  if (token.length < 20) throw new Error('Render API token is too short.');
  if (/[^\x21-\x7e]/.test(token)) throw new Error('Render API token contains invalid characters or whitespace.');
  return token;
}

export function createRenderAuth({ input, remember, testButton, clearButton, status }) {
  let generation = 0;
  let verifiedToken = null;
  function show(message, state = 'pending') {
    status.textContent = message;
    status.dataset.state = state;
  }
  function clearSaved() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* optional storage */ }
  }
  function saveVerified() {
    clearSaved();
    if (!remember.checked || !verifiedToken) return false;
    try { sessionStorage.setItem(STORAGE_KEY, verifiedToken); return true; }
    catch { return false; }
  }
  function authorization() { return 'Bearer ' + validateToken(input.value); }
  async function request(path, options = {}) {
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      throw new Error('Refusing to send Render API token outside the application API.');
    }
    const token = validateToken(input.value);
    const requestGeneration = generation;
    const headers = new Headers(options.headers);
    headers.set('Authorization', 'Bearer ' + token);
    const response = await fetch(url, { ...options, headers, cache: 'no-store', redirect: 'error' });
    if (response.status === 401) {
      if (generation === requestGeneration && normalizeToken(input.value) === token) {
        verifiedToken = null;
        clearSaved();
        show('Authentication failed. Correct the token and click Test Connection.', 'error');
      }
      throw new Error('Invalid Render API token. Use Test Connection, then retry.');
    }
    return response;
  }
  async function verify() {
    const currentGeneration = generation;
    const originalValue = input.value;
    testButton.disabled = true;
    show('Testing authentication...');
    try {
      const token = validateToken(originalValue);
      const response = await request('/api/auth/verify');
      if (!response.ok) throw new Error('Authentication test failed: HTTP ' + response.status);
      const result = await response.json();
      if (result.authenticated !== true) throw new Error('Unexpected authentication response.');
      if (generation !== currentGeneration || input.value !== originalValue) return;
      input.value = token;
      verifiedToken = token;
      const saved = saveVerified();
      show('Authentication successful. Token length: ' + token.length + (saved ? '. Saved for this tab session.' : remember.checked ? '. Session storage unavailable.' : '.') , 'success');
    } catch (err) {
      if (generation !== currentGeneration || input.value !== originalValue) return;
      verifiedToken = null;
      clearSaved();
      show(err.message, 'error');
    } finally { testButton.disabled = false; }
  }
  input.addEventListener('input', () => {
    generation++;
    verifiedToken = null;
    clearSaved();
    show('Token changed. Test connection before recording.');
  });
  remember.addEventListener('change', () => {
    if (!remember.checked) clearSaved();
    else if (verifiedToken && normalizeToken(input.value) === verifiedToken) {
      const saved = saveVerified();
      show(saved ? 'Authentication successful. Saved for this tab session.' : 'Authentication successful. Session storage unavailable.', 'success');
    } else show('Click Test Connection to save a verified token.');
  });
  clearButton.addEventListener('click', () => {
    generation++;
    input.value = '';
    remember.checked = false;
    verifiedToken = null;
    clearSaved();
    show('Token cleared.');
  });
  testButton.addEventListener('click', verify);
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved && !input.value) {
      input.value = saved;
      remember.checked = true;
      show('Saved token loaded. Rechecking authentication...');
      void verify();
    }
  } catch { /* optional storage */ }
  return { authorization, request, verify };
}
