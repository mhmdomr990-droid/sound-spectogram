const WebSocket = require('ws');
const fs = require('fs');
const CDP_HTTP = 'http://127.0.0.1:9222';
const BASE = 'http://127.0.0.1:3111';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function httpJson(u, o) { return (await fetch(u, o)).json(); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const c = new CDP(ws);
    ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && c.pending.has(m.id)) { const { resolve, reject } = c.pending.get(m.id); c.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } else c.events.push(m); });
    return c;
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  waitEvent(method, ms = 25000) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + method)), ms); this.events.push(method); const ck = () => { const i = this.events.findIndex(e => e === method); if (i >= 0) { clearTimeout(t); this.events.splice(i, 1); res(); } }; ck(); this.iv = setInterval(ck, 40); }).finally(() => clearInterval(this.iv)); }
  close() { try { this.ws.close(); } catch (_) {} }
}
async function ev(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception));
  return r.result.value;
}
async function main() {
  const tab = await httpJson(CDP_HTTP + '/json/new?' + encodeURIComponent(BASE + '/login'), { method: 'PUT' });
  const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.waitEvent('Page.loadEventFired');
  await ev(cdp, `(async () => { const r = await fetch('${BASE}/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:'admin',password:'r7ZZqT79l57EOBv'}) }); const j = await r.json(); if (!j.token) return 'fail'; localStorage.setItem('token', j.token); localStorage.setItem('user', JSON.stringify(j.user||{})); return 'ok'; })()`);
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await cdp.waitEvent('Page.loadEventFired');
  await sleep(1500);
  await ev(cdp, `(() => { const sel = document.getElementById('deviceList'); sel.value='1'; sel.dispatchEvent(new Event('change')); return 'ok'; })()`);
  await sleep(3000);
  await ev(cdp, `document.getElementById('latestPacketBtn').click()`);
  await sleep(6000);
  const info = await ev(cdp, `(() => {
    const all = [...document.querySelectorAll('canvas')];
    return JSON.stringify(all.map((c,i)=>({
      i, id:c.id, cls:c.className, w:c.width, h:c.height, cw:c.clientWidth, ch:c.clientHeight,
      gl: (()=>{ try { return !!c.getContext('webgl') || !!c.getContext('experimental-webgl'); } catch(e){ return false; } })(),
      inViewport: !!c.getBoundingClientRect && c.getBoundingClientRect().width>0,
      rect: (()=>{ const r=c.getBoundingClientRect(); return {l:r.left,t:r.top,w:r.width,h:r.height}; })()
    })));
  })()`);
  console.log('canvases:', info);
  cdp.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR:', e.message); process.exit(1); });