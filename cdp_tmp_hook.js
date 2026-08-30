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
const HOOK = `(() => {
  if (window.__hooked2) return 'already';
  window.__hooked2 = true;
  window.__texCap = [];
  window.__drawCap = [];
  const proto = WebGLRenderingContext.prototype;
  const origTex = proto.texImage2D;
  proto.texImage2D = function(...args) {
    const res = origTex.apply(this, args);
    try {
      const data = args[8] || args[6];
      if (data instanceof Uint8Array && args[3]*args[4] === data.length && window.__texCap.length < 20) {
        const w=args[3], h=args[4];
        let nz=0,s=0,mx=0;
        for (let i=0;i<data.length;i++){ const v=data[i]; if(v>0)nz++; s+=v; if(v>mx)mx=v; }
        window.__texCap.push({kind:'lum', w, h, nzPct:+(100*nz/(w*h)).toFixed(3), mean:+(s/data.length).toFixed(3), max:mx});
      }
      if (data instanceof Uint8Array && args[3]===256 && args[4]===1) window.__texCap.push({kind:'palette'});
    } catch(e){}
    return res;
  };
  const origDraw = proto.drawArrays;
  proto.drawArrays = function(mode, first, count) {
    window.__drawCap.push({mode, first, count, gl: !!this});
    return origDraw.apply(this, arguments);
  };
  return 'hooked2';
})()`;
const READ = `(() => JSON.stringify({tex: window.__texCap, draw: window.__drawCap}))()`;
async function main() {
  const tab = await httpJson(CDP_HTTP + '/json/new?' + encodeURIComponent(BASE + '/login'), { method: 'PUT' });
  const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.waitEvent('Page.loadEventFired');
  await ev(cdp, `(async () => { const r = await fetch('${BASE}/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:'admin',password:'r7ZZqT79l57EOBv'}) }); const j = await r.json(); if (!j.token) return 'fail'; localStorage.setItem('token', j.token); localStorage.setItem('user', JSON.stringify(j.user||{})); return 'ok'; })()`);
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await cdp.waitEvent('Page.loadEventFired');
  await sleep(1200);
  console.log('hook:', await ev(cdp, HOOK));
  await ev(cdp, `(() => { const sel = document.getElementById('deviceList'); sel.value='1'; sel.dispatchEvent(new Event('change')); return 'ok'; })()`);
  await sleep(2000);
  await ev(cdp, `document.getElementById('latestPacketBtn').click()`);
  await sleep(6000);
  // force a re-render to trigger GL again
  await ev(cdp, `document.getElementById('resetViewBtn').click()`);
  await sleep(3000);
  const data = JSON.parse(await ev(cdp, READ));
  console.log('tex captures:', JSON.stringify(data.tex));
  console.log('draw calls:', JSON.stringify(data.draw));
  cdp.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR:', e.message); process.exit(1); });