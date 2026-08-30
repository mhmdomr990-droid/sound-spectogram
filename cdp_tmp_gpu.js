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
  if (window.__h3) return 'already';
  window.__h3 = true;
  window.__tex = [];
  window.__drawImg = [];
  const gproto = WebGLRenderingContext.prototype;
  const origTex = gproto.texImage2D;
  gproto.texImage2D = function(...a) {
    const r = origTex.apply(this, a);
    try {
      const d = a[8] || a[6];
      if (d instanceof Uint8Array && a[3]*a[4] === d.length && window.__tex.length < 20) {
        const w=a[3],h=a[4]; let nz=0,s=0,mx=0; for (let i=0;i<d.length;i++){const v=d[i]; if(v>0)nz++; s+=v; if(v>mx)mx=v;}
        window.__tex.push({w,h,nzPct:+(100*nz/(w*h)).toFixed(3),mean:+(s/d.length).toFixed(3),max:mx});
      }
    } catch(e){}
    return r;
  };
  const cproto = CanvasRenderingContext2D.prototype;
  const origDraw = cproto.drawImage;
  cproto.drawImage = function(...a) {
    try { window.__drawImg.push({n:a.length, arg0:a[0]&&a[0].tagName, aw:a[0]&&a[0].width, ah:a[0]&&a[0].height, src:[a[4],a[5],a[6],a[7]], dst:[a[8],a[9],a[10],a[11]]}); } catch(e){}
    return origDraw.apply(this, a);
  };
  return 'ok';
})()`;
const READ = `(() => JSON.stringify({tex:window.__tex, drawImg:window.__drawImg}))()`;
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
  await sleep(2500);
  await ev(cdp, `document.getElementById('latestPacketBtn').click()`);
  await sleep(6000);
  const info = JSON.parse(await ev(cdp, READ));
  console.log('TEX:', JSON.stringify(info.tex));
  console.log('DRAWIMAGE:', JSON.stringify(info.drawImg && info.drawImg.slice ? info.drawImg.slice(-5) : info.drawImg));
  cdp.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR:', e.message); process.exit(1); });