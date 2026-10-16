
const allowedOrigins = new Set(__ALLOWED_ORIGINS__);
const authorizationUrl = __AUTHORIZATION_URL__;
const registryUrl = __REGISTRY_URL__;
const oauthStartPath = __OAUTH_START_PATH__;
const pendingKey = 'duowei-print:pending-template-sync';
const inflight = new Set();
const setStatus = (text, state = '') => {
  const node = document.getElementById('status');
  node.textContent = text;
  node.dataset.state = state;
};
const cleanMessage = (value) => String(value || '自动化模板同步失败')
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [已隐藏]')
  .replace(/((?:client[_-]?secret|access[_-]?token|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[已隐藏]')
  .slice(0, 300);
const readJson = async (response) => {
  try { return await response.json(); } catch { return {}; }
};
const reply = (source, origin, payload) => source.postMessage(payload, origin);
const readPending = () => {
  try {
    const item = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
    if (!item || !allowedOrigins.has(item.origin)
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(item.requestId)
      || !item.body || typeof item.body !== 'object'
      || !Number.isSafeInteger(item.createdAt)
      || Date.now() - item.createdAt > 5 * 60 * 1000) throw new Error('invalid');
    return item;
  } catch {
    sessionStorage.removeItem(pendingKey);
    return null;
  }
};
const sync = async (source, origin, requestId, body, resumed) => {
  if (inflight.has(requestId)) return;
  inflight.add(requestId);
  setStatus(resumed ? '已连接飞书，正在同步模板…' : '正在验证连接并同步模板…');
  try {
    const authorizationResponse = await fetch(authorizationUrl, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-duowei-plugin-origin': origin },
      body: JSON.stringify(body),
    });
    const authorization = await readJson(authorizationResponse);
    if (authorizationResponse.status === 401 && authorization.code === 'AUTH_REQUIRED'
      && typeof authorization.connectUrl === 'string' && !resumed) {
      const connectUrl = new URL(authorization.connectUrl);
      if (connectUrl.origin !== window.location.origin || connectUrl.pathname !== oauthStartPath) {
        throw new Error('飞书连接地址不受信任');
      }
      sessionStorage.setItem(pendingKey, JSON.stringify({ origin, requestId, body, createdAt: Date.now() }));
      setStatus('请在此窗口完成飞书连接，完成后会自动同步模板。');
      window.location.assign(connectUrl.toString());
      return;
    }
    if (!authorizationResponse.ok || authorization.success !== true
      || typeof authorization.authorization !== 'string' || !authorization.body) {
      const detail = authorization.message || authorization.error_msg || authorizationResponse.statusText
        || ('HTTP ' + authorizationResponse.status);
      throw Object.assign(new Error(cleanMessage(detail)), {
        code: typeof authorization.code === 'string' ? authorization.code : 'AUTHORIZATION_FAILED',
      });
    }
    const registryResponse = await fetch(registryUrl, {
      method: 'POST', credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-duowei-service-signature': authorization.authorization,
      },
      body: JSON.stringify(authorization.body),
    });
    const registry = registryResponse.status === 204 ? {} : await readJson(registryResponse);
    if (!registryResponse.ok) {
      throw Object.assign(new Error(cleanMessage(registry.message || registryResponse.statusText)), {
        code: typeof registry.code === 'string' ? registry.code : 'REGISTRY_WRITE_FAILED',
      });
    }
    sessionStorage.removeItem(pendingKey);
    reply(source, origin, {
      type: 'duowei-print:bridge-result', protocolVersion: 1, requestId, success: true,
    });
    setStatus('当前模板已同步。你可以返回多维表格继续操作。', 'success');
  } catch (error) {
    sessionStorage.removeItem(pendingKey);
    reply(source, origin, {
      type: 'duowei-print:bridge-result', protocolVersion: 1, requestId, success: false,
      code: typeof error?.code === 'string' ? error.code : 'BRIDGE_FAILED',
      message: cleanMessage(error?.message),
    });
    setStatus('同步失败，请返回多维表格重试。', 'error');
  } finally {
    inflight.delete(requestId);
  }
};
window.addEventListener('message', async (event) => {
  if (!allowedOrigins.has(event.origin) || event.source !== window.opener) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.protocolVersion !== 1) return;
  if (data.type === 'duowei-print:bridge-probe') {
    reply(event.source, event.origin, { type: 'duowei-print:oauth-connected', protocolVersion: 1 });
    setStatus('已连接，请保持此窗口开启后返回多维表格。', 'ready');
    return;
  }
  if (data.type !== 'duowei-print:bridge-sync') return;
  const requestId = typeof data.requestId === 'string' ? data.requestId : '';
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) return;
  await sync(event.source, event.origin, requestId, data.body, false);
});
const pending = readPending();
if (pending && window.opener) {
  void sync(window.opener, pending.origin, pending.requestId, pending.body, true);
} else {
  setStatus('正在等待多维打印连接…');
}