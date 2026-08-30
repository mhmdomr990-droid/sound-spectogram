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
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/tmp/dashboard_repro.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved /tmp/dashboard_repro.png');
  const status = await ev(cdp, `(() => {
    const c = document.getElementById('spectrogramCanvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0,0,c.width,c.height).data;
    let br=0,nb=0;
    for (let i=0;i<d.length;i+=4){ const l=0.3*d[i]+0.59*d[i+1]+0.11*d[i+2]; if(l>60)br++; if(l>10)nb++; }
    return JSON.stringify({w:c.width,h:c.height, bright:+(100*br/(c.width*c.height)).toFixed(2), nb:+(100*nb/(c.width*c.height)).toFixed(2), status:(document.getElementById('processingStatus')||{}).textContent, supportsWebGL: !!window.Spectrogram});
  })()`);
  console.log('canvas:', status);
  const durl = await ev(cdp, `document.getElementById('spectrogramCanvas').toDataURL()`);
  fs.writeFileSync('/tmp/web_canvas_repro.txt', durl);
  console.log('canvas toDataURL length:', durl.length);
  cdp.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR:', e.message); process.exit(1); });