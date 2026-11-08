/* NextFloor Alarm Shield v1.1.0 — MIT. Display only; never arms or disarms an alarm.
 * Public API 1 supplies settings and markers. An isolated, feature-checked adapter
 * projects the shell with NextFloor's existing camera (tested with 0.24.0).
 * No imports, external requests, credentials, telemetry, or hard-coded home geometry.
 */
export const ID = 'alarm-shield';
export const VERSION = '1.1.0';
const DEFAULTS = { enabled: true, opacity: 16, margin: 0.9, color: 'red', pulse: true, grid: false, outbuildings: false, house_only: true };
const COLORS = { red: [255, 73, 104], cyan: [67, 225, 255], violet: [177, 133, 255] };
const LABELS = { disarmed: 'Unscharf', armed_home: 'Zuhause scharf', armed_away: 'Abwesend scharf', armed_night: 'Nachts scharf', armed_vacation: 'Urlaub scharf', armed_custom_bypass: 'Benutzerdefiniert scharf', arming: 'Ausgangsverzögerung', pending: 'Eingangsverzögerung', triggered: 'ALARM', disarming: 'Wird unscharf', unknown: 'Unbekannt', unavailable: 'Nicht verfügbar' };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function settings(raw = {}) {
  const number = (k, lo, hi) => Number.isFinite(Number(raw[k])) && raw[k] !== null && raw[k] !== '' ? clamp(Number(raw[k]), lo, hi) : DEFAULTS[k];
  const bool = k => typeof raw[k] === 'boolean' ? raw[k] : DEFAULTS[k];
  return { enabled: bool('enabled'), opacity: number('opacity', 0, 45), margin: number('margin', 0.3, 3), color: Object.hasOwn(COLORS, raw.color) ? raw.color : 'red', pulse: bool('pulse'), grid: bool('grid'), outbuildings: bool('outbuildings'), house_only: bool('house_only'), shape: raw.shape === 'sphere' ? 'sphere' : 'dome' };
}
export function stateStyle(state, cfg, seconds = 0, reduced = false) {
  const armed = typeof state === 'string' && state.startsWith('armed_');
  const delay = state === 'arming' || state === 'pending';
  const alarm = state === 'triggered';
  if (!cfg.enabled || !(armed || delay || alarm)) return null;
  const color = alarm ? [255, 45, 70] : delay ? [255, 177, 65] : COLORS[cfg.color];
  const wave = !reduced && cfg.pulse ? 0.5 - Math.cos(seconds * Math.PI * 2 / (alarm ? 1.6 : delay ? 2.6 : 5)) / 2 : 0.5;
  return { color, alpha: clamp(cfg.opacity / 100 * (alarm ? 1.5 + wave * 0.65 : delay ? 1 + wave * 0.35 : 0.82 + wave * 0.18), 0, 0.65), label: LABELS[state] ?? state, alarm };
}
const boundsOf = (floor, room) => {
  const p = room.points.filter(p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite));
  return p.length < 3 ? null : { x0: Math.min(...p.map(p => p[0])), x1: Math.max(...p.map(p => p[0])), z0: Math.min(...p.map(p => p[1])), z1: Math.max(...p.map(p => p[1])), y0: floor.elevation + (room.level ?? 0), y1: floor.elevation + floor.height, weight: (Math.max(...p.map(p => p[0])) - Math.min(...p.map(p => p[0]))) * (Math.max(...p.map(p => p[1])) - Math.min(...p.map(p => p[1]))) };
};
const near = (a, b, gap = 0.7) => a.x0 <= b.x1 + gap && a.x1 >= b.x0 - gap && a.z0 <= b.z1 + gap && a.z1 >= b.z0 - gap;
export function houseBounds(building, cfg) {
  let boxes = (building?.floors ?? []).filter(f => !f.layer).flatMap(f => (f.rooms ?? []).map(r => boundsOf(f, r)).filter(Boolean));
  if (!boxes.length) return null;
  if (!cfg.outbuildings) {
    // Largest connected cluster across storeys: keeps a detached garage out by default.
    const remaining = new Set(boxes), groups = [];
    while (remaining.size) {
      const group = [remaining.values().next().value]; remaining.delete(group[0]);
      for (let i = 0; i < group.length; i++) for (const box of remaining) if (near(group[i], box)) { remaining.delete(box); group.push(box); }
      groups.push(group);
    }
    boxes = groups.sort((a, b) => b.reduce((v, x) => v + x.weight, 0) - a.reduce((v, x) => v + x.weight, 0))[0];
  }
  const out = { x0: Math.min(...boxes.map(b => b.x0)), x1: Math.max(...boxes.map(b => b.x1)), z0: Math.min(...boxes.map(b => b.z0)), z1: Math.max(...boxes.map(b => b.z1)), y0: Math.min(...boxes.map(b => b.y0)), y1: Math.max(...boxes.map(b => b.y1)) };
  for (const r of building.settings?.roof?.sections ?? []) {
    const box = { x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1), z0: Math.min(r.z0, r.z1), z1: Math.max(r.z0, r.z1) };
    if (!Object.values(box).every(Number.isFinite) || !near(out, box, 0.2)) continue;
    const base = Math.max(r.base ?? 0, r.eave_a ?? 0, r.eave_b ?? 0);
    const span = r.shape === 'pent' ? Math.max(box.x1 - box.x0, box.z1 - box.z0) : Math.min(box.x1 - box.x0, box.z1 - box.z0) / 2;
    out.y1 = Math.max(out.y1, base + (r.shape === 'flat' || r.shape === 'parapet' ? 0 : Math.tan((r.pitch ?? 0) * Math.PI / 180) * span));
  }
  return out;
}
export function shellMesh(box, margin = 0.9, rings = 16, segments = 48, shape = 'dome') {
  const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2, base = box.y0 - 0.12;
  const sphere = shape === 'sphere';
  const cy = sphere ? (box.y0 + box.y1) / 2 : base;
  const radius = Math.hypot((box.x1 - box.x0) / 2, (box.z1 - box.z0) / 2, (box.y1 - box.y0) / 2) + margin;
  const rx = sphere ? radius : (box.x1 - box.x0) * 0.78 + margin, rz = sphere ? radius : (box.z1 - box.z0) * 0.78 + margin, ry = sphere ? radius : (box.y1 - base) * 1.3 + margin;
  const vertices = [], faces = [], grid = [];
  for (let j = 0; j <= rings; j++) for (let k = 0; k < segments; k++) {
    const a = k / segments * Math.PI * 2, b = sphere ? (j / rings - 0.5) * Math.PI : j / rings * Math.PI / 2;
    vertices.push([cx + rx * Math.cos(b) * Math.cos(a), cy + ry * Math.sin(b), cz + rz * Math.cos(b) * Math.sin(a)]);
  }
  for (let j = 0; j < rings; j++) for (let k = 0; k < segments; k++) {
    const a = j * segments + k, b = j * segments + (k + 1) % segments, c = a + segments, d = b + segments;
    faces.push([a, b, c], [b, d, c]);
    if (j % 3 === 0) grid.push([a, b]);
    if (k % 4 === 0) grid.push([a, c]);
  }
  return { vertices, faces, grid, ring: sphere ? [] : Array.from({ length: segments }, (_, k) => k), center: [cx, sphere ? cy : base + ry * 0.45, cz] };
}
export function project(point, view, projection, width, height) {
  const [x, y, z] = point;
  const v = [view[0]*x+view[4]*y+view[8]*z+view[12], view[1]*x+view[5]*y+view[9]*z+view[13], view[2]*x+view[6]*y+view[10]*z+view[14], view[3]*x+view[7]*y+view[11]*z+view[15]];
  const c = [0, 1, 2, 3].map(i => projection[i]*v[0]+projection[4+i]*v[1]+projection[8+i]*v[2]+projection[12+i]*v[3]);
  if (c[3] <= 0.05 || c.some(x => !Number.isFinite(x))) return null;
  return [(c[0]/c[3]+1)*width/2, (1-c[1]/c[3])*height/2, c[2]/c[3]];
}
export function findAlarm(building, hass) {
  for (const f of building?.floors ?? []) for (const p of f.placements ?? []) if (p.entity_id?.startsWith('alarm_control_panel.') && p.plugin?.[ID]) return { entity: p.entity_id, placement: p, floor: f, cfg: settings(p.plugin[ID]), state: hass?.states?.[p.entity_id]?.state ?? 'unavailable' };
  return null;
}

// Only this adapter touches NextFloor implementation details. Never patches its prototypes or renderer.
export function viewAdapter(host) {
  const viewer = host?.viewer, canvas = viewer?.renderer?.domElement, camera = viewer?.camera;
  const v = camera?.matrixWorldInverse?.elements, p = camera?.projectionMatrix?.elements;
  if (!canvas?.parentElement || !v || !p || v.length !== 16 || p.length !== 16 || !host.building || !host.hass) return null;
  return { viewer, canvas, v, p, building: host.building, hass: host.hass };
}
const rgba = (rgb, alpha) => `rgba(${rgb.join(',')},${alpha})`;
export function convexHull(points) {
  const sorted=points.filter(Boolean).map(p=>[p[0],p[1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=pts=>{const out=[];for(const p of pts){while(out.length>=2&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p);}return out;};
  if(sorted.length<3)return sorted;
  const lower=half(sorted),upper=half([...sorted].reverse());lower.pop();upper.pop();return [...lower,...upper];
}
function paint(ctx, mesh, adapter, width, height, style, cfg) {
  const pts = mesh.vertices.map(p => project(p, adapter.v, adapter.p, width, height));
  const faces = mesh.faces.map(face => ({ face, depth: face.reduce((sum, i) => sum + (pts[i]?.[2] ?? 0), 0) / 3 })).sort((a, b) => b.depth - a.depth);
  ctx.clearRect(0, 0, width, height);
  // Very faint faces, a stronger silhouette and a glowing ground ring: the home stays readable.
  for (const { face } of faces) {
    if (face.some(i => !pts[i] || pts[i][2] < -1 || pts[i][2] > 1)) continue;
    const [a, b, c] = face.map(i => pts[i]);
    const area = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if (Math.abs(area) < 0.05) continue;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath();
    ctx.fillStyle = rgba(style.color, style.alpha * (area > 0 ? 0.42 : 0.18)); ctx.fill();
  }
  if (cfg.grid) {
    ctx.strokeStyle = rgba(style.color, style.alpha * 0.45); ctx.lineWidth = 0.65; ctx.beginPath();
    for (const [a, b] of mesh.grid) if (pts[a] && pts[b]) { ctx.moveTo(pts[a][0], pts[a][1]); ctx.lineTo(pts[b][0], pts[b][1]); }
    ctx.stroke();
  }
  const ring = mesh.ring.map(i => pts[i]);
  if (ring.length && ring.every(Boolean)) {
    ctx.save(); ctx.beginPath(); ring.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    ctx.strokeStyle = rgba(style.color, Math.min(0.8, style.alpha * 2)); ctx.lineWidth = 1.4; ctx.shadowColor = rgba(style.color, 0.8); ctx.shadowBlur = 12; ctx.stroke(); ctx.restore();
  }
  // Silhouette from the visible shell's extreme points, not a screen-sized vignette.
  const outline=convexHull(pts);
  if (outline.length>=3) {
    ctx.save(); ctx.beginPath(); outline.forEach((p, i) => i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1])); ctx.closePath(); ctx.lineWidth=1.2; ctx.strokeStyle=rgba(style.color,style.alpha*1.8); ctx.shadowColor=rgba(style.color,0.7); ctx.shadowBlur=15; ctx.stroke(); ctx.restore();
  }
}

class ShieldView {
  constructor(host, manager) {
    this.host = host; this.manager = manager; this.frame = 0; this.lastDraw = 0; this.signature = '';
    this.overlay = document.createElement('div'); this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden;';
    this.canvas = document.createElement('canvas'); this.canvas.style.cssText = 'display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;pointer-events:none!important;'; this.canvas.setAttribute('aria-hidden','true');
    this.badge = document.createElement('div'); this.badge.style.cssText = 'display:none;position:absolute;top:68px;left:50%;transform:translateX(-50%);padding:8px 14px;border:1px solid #ff7790;border-radius:20px;background:#241422e8;color:#ffe3e9;font:600 13px system-ui;text-align:center;';
    this.overlay.append(this.canvas, this.badge); this.ctx = this.canvas.getContext('2d');
  }
  check() {
    if (!this.host.isConnected) return this.dispose();
    const a = viewAdapter(this.host); if (!a || !this.ctx) return this.stop();
    const alarm = findAlarm(a.building, a.hass), preview = this.manager.preview?.until > Date.now() ? this.manager.preview : null;
    if (!alarm) return this.stop();
    const cfg = preview?.cfg ?? alarm.cfg;
    const state = preview?.state ?? alarm.state;
    const show = !document.hidden && (!cfg.house_only || !this.host.floorId && !this.host.roomId) && stateStyle(state, cfg);
    if (!show) return this.stop();
    this.active = { a, alarm, cfg, state, preview };
    if (this.overlay.parentNode !== a.canvas.parentElement) a.canvas.parentElement.append(this.overlay);
    this.badge.style.display = preview ? 'block' : 'none';
    this.badge.textContent = preview ? `VORSCHAU · ${LABELS[state] ?? state} · Alarmanlage unverändert` : '';
    if (!this.frame) this.frame = requestAnimationFrame(t => this.draw(t));
  }
  draw(time) {
    this.frame = 0;
    if (!this.active || !this.host.isConnected || document.hidden) return;
    const { cfg, state, preview } = this.active, a = viewAdapter(this.host);
    if (!a || preview && preview.until <= Date.now()) return this.check();
    if (time-this.lastDraw >= (this.host.quality === 'low' ? 65 : 33)) {
      this.lastDraw=time;
      const rect=a.canvas.getBoundingClientRect(), w=rect.width, h=rect.height;
      if (w>0 && h>0 && rect.bottom>0 && rect.top<innerHeight) {
        const dpr=Math.min(devicePixelRatio || 1,1.5);
        if (this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)) { this.canvas.width=Math.round(w*dpr); this.canvas.height=Math.round(h*dpr); }
        this.ctx.setTransform(dpr,0,0,dpr,0,0);
        const key=JSON.stringify([cfg.outbuildings,cfg.margin,cfg.shape]);
        if(a.building!==this.meshBuilding || key!==this.meshKey){this.meshBuilding=a.building;this.meshKey=key;const box=houseBounds(a.building,cfg);this.mesh=box?shellMesh(box,cfg.margin,16,48,cfg.shape):null;}
        const style=stateStyle(state,cfg,time/1000,this.manager.reduced.matches);
        if(this.mesh&&style)paint(this.ctx,this.mesh,a,w,h,style,cfg);
      }
    }
    this.frame=requestAnimationFrame(t=>this.draw(t));
  }
  stop() { this.active=null; if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.overlay.remove(); }
  dispose(){this.stop();this.manager.views.delete(this.host);}
}

function scan(root, found) {
  for (const el of root.querySelectorAll('*')) { if(el.localName==='nf-view3d')found.add(el); if(el.shadowRoot)scan(el.shadowRoot,found); }
}
function element(tag, text) { const node=document.createElement(tag); if(text!==undefined)node.textContent=text;return node; }
class ShieldManager {
  constructor() {
    this.views=new Map(); this.preview=null; this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    this.onEvent=e=>{if(e.detail?.nextfloor_shield?.action==='settings'){const host=e.composedPath().find(n=>n?.localName==='nf-view3d');this.open(host);}};
    document.addEventListener('ll-custom',this.onEvent);
    this.scanTimer=setInterval(()=>{const found=new Set();scan(document,found);for(const host of found)if(!this.views.has(host))this.views.set(host,new ShieldView(host,this));},1500);
    this.tickTimer=setInterval(()=>{for(const v of this.views.values())v.check();},350);
  }
  dispose(){clearInterval(this.scanTimer);clearInterval(this.tickTimer);document.removeEventListener('ll-custom',this.onEvent);this.dialog?.remove();for(const v of [...this.views.values()])v.dispose();}
  open(preferred) {
    const host=preferred ?? [...this.views.keys()].find(h=>h.isConnected&&viewAdapter(h));
    const a=host?.building&&host?.hass?{building:host.building,hass:host.hass}:null, alarm=a&&findAlarm(a.building,a.hass); if(!alarm)return;
    this.dialog?.remove();
    const dialog=element('dialog'); this.dialog=dialog;
    dialog.style.cssText='color:#e9efff;background:#121a2b;border:1px solid #566987;border-radius:18px;padding:24px;max-width:520px;width:calc(100vw - 48px);font:14px/1.5 system-ui;box-sizing:border-box;';
    dialog.append(element('h2','Alarm-Schutzschild'),element('p',`Alarmanlage: ${LABELS[alarm.state]??alarm.state}`),element('p','Die Vorschau ändert ausschließlich die Darstellung, niemals den Zustand der Alarmanlage. Sie endet nach 30 Sekunden.'));
    const status=element('p',viewAdapter(host)?'':'Diese NextFloor-Version bietet dem Ansichtsadapter noch keine kompatible Kamera. Der Schild bleibt ausgeblendet.');status.setAttribute('role','status');
    let cfg={...alarm.cfg};
    const controls=element('div');controls.style.cssText='display:grid;gap:12px;';
    for(const [key,label,min,max,step] of [['opacity','Schimmerstärke (%)',0,45,1],['margin','Abstand zum Haus (m)',0.3,3,0.1]]){
      const wrap=element('label',label+' '),input=element('input');input.type='number';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(cfg[key]);input.style.cssText='width:80px;padding:5px;';input.oninput=()=>{cfg=settings({...cfg,[key]:Number(input.value)});if(this.preview)this.preview.cfg=cfg;};wrap.append(input);controls.append(wrap);
    }
    const shapeWrap = element('label', 'Form '), shapeSelect = element('select');
    for (const [value, label] of [['dome', 'Kuppel'], ['sphere', 'Kugel']]) {
      const option = element('option', label);
      option.value = value; option.selected = value === cfg.shape;
      shapeSelect.append(option);
    }
    shapeSelect.onchange = () => {
      cfg = settings({ ...cfg, shape: shapeSelect.value });
      if (this.preview) this.preview.cfg = cfg;
    };
    shapeWrap.append(shapeSelect); controls.append(shapeWrap);
    const colorWrap=element('label','Farbe '),select=element('select');for(const [value,text]of [['red','Rot'],['cyan','Cyan'],['violet','Violett']]){const opt=element('option',text);opt.value=value;opt.selected=value===cfg.color;select.append(opt);}select.onchange=()=>{cfg={...cfg,color:select.value};if(this.preview)this.preview.cfg=cfg;};colorWrap.append(select);controls.append(colorWrap);
    for(const [key,label]of [['enabled','Schutzschild aktiv'],['pulse','Sanft pulsieren'],['grid','Energiegitter zeigen'],['outbuildings','Freistehende Nebengebäude einschließen'],['house_only','Nur in der Haus-Gesamtansicht']]){const wrap=element('label'),input=element('input');input.type='checkbox';input.checked=cfg[key];input.onchange=()=>{cfg={...cfg,[key]:input.checked};if(this.preview)this.preview.cfg=cfg;};wrap.append(input,document.createTextNode(' '+label));controls.append(wrap);}
    dialog.append(controls,element('h3','Nur visuelle Vorschau'));
    const buttons=element('div');buttons.style.cssText='display:flex;flex-wrap:wrap;gap:8px;';
    for(const [state,label]of [['armed_away','Scharf ansehen'],['pending','Verzögerung ansehen'],['triggered','Alarm ansehen']]){const button=element('button',label);button.onclick=()=>{this.preview={state,cfg:{...cfg,enabled:true},until:Date.now()+30000};status.textContent='Vorschau läuft 30 Sekunden; die Alarmanlage bleibt unverändert.';dialog.close();for(const v of this.views.values())v.check();};buttons.append(button);}
    const stop=element('button','Vorschau beenden');stop.onclick=()=>{this.preview=null;for(const v of this.views.values())v.check();status.textContent='Live-Darstellung wiederhergestellt.';};buttons.append(stop);dialog.append(buttons,status);
    const footer=element('div');footer.style.cssText='display:flex;gap:10px;margin-top:22px;';
    const save=element('button','Im Plan speichern');save.onclick=async()=>{save.disabled=true;try{
      const current=await a.hass.callWS({type:'nextfloor/building/get'}), building=current.building;
      const target=building.floors.flatMap(f=>f.placements??[]).find(p=>p.entity_id===alarm.entity&&p.plugin?.[ID]);
      if(!target)throw Error('Alarm-Platzierung fehlt. Bitte Ansicht neu laden.');
      if(JSON.stringify(settings(target.plugin[ID]))!==JSON.stringify(alarm.cfg))throw Error('Einstellungen wurden inzwischen geändert. Dialog schließen und erneut öffnen.');
      target.plugin[ID]=settings(cfg);await a.hass.callWS({type:'nextfloor/building/save',building});
      this.preview=null;status.textContent='Einstellungen dauerhaft im Plan gespeichert.';
    }catch(e){status.textContent=e.message??String(e);}finally{save.disabled=false;}};
    const close=element('button','Schließen');close.onclick=()=>dialog.close();footer.append(save,close);dialog.append(footer);
    for(const b of dialog.querySelectorAll('button'))b.style.cssText='padding:9px 12px;border-radius:9px;border:1px solid #67768e;background:#22314b;color:white;cursor:pointer;font:inherit;';
    // Stay within the active fullscreen element if the user entered real browser fullscreen.
    (document.fullscreenElement??document.body).append(dialog);dialog.showModal();
  }
}

const plugin = {
  id:ID,name:'Alarm-Schutzschild',version:VERSION,apiVersion:1,
  devices:[{match:id=>id.startsWith('alarm_control_panel.'),kind:'sensor',
    marker:({state})=>({icon:state.state==='disarmed'?'mdi:shield-off-outline':'mdi:shield-home',text:LABELS[state.state]??state.state,active:state.state.startsWith('armed_')||state.state==='triggered'}),
    settings:[
      {key:'enabled',label:{de:'Schutzschild aktiv',en:'Enable shield'},type:'boolean',default:true},
      {key:'opacity',label:{de:'Schimmerstärke (%)',en:'Glow intensity (%)'},type:'number',default:16,min:0,max:45,step:1},
      {key:'margin',label:{de:'Abstand zum Haus (m)',en:'House padding (m)'},type:'number',default:0.9,min:0.3,max:3,step:0.1},
      {key:'color',label:{de:'Farbe bei scharf',en:'Armed color'},type:'select',default:'red',options:[['red','Rot / Red'],['cyan','Cyan'],['violet','Violett / Violet']]},
      {key:'shape',label:{de:'Form',en:'Shape'},type:'select',default:'dome',options:[['dome','Kuppel / Dome'],['sphere','Kugel / Sphere']]},
      {key:'pulse',label:{de:'Sanft pulsieren',en:'Soft pulse'},type:'boolean',default:true},
      {key:'grid',label:{de:'Energiegitter',en:'Energy grid'},type:'boolean',default:false},
      {key:'outbuildings',label:{de:'Nebengebäude einschließen',en:'Include detached buildings'},type:'boolean',default:false},
      {key:'house_only',label:{de:'Nur Haus-Gesamtansicht',en:'House overview only'},type:'boolean',default:true}
    ],tap:({placement})=>{runtime?.open([...runtime.views.keys()].find(h=>h.building?.floors.some(f=>f.id===placement.floorId)));return true;}}],
  roomSections:[{id:'alarm-shield-preview',render:({entities})=>{if(!entities.some(id=>id.startsWith('alarm_control_panel.')))return null;const node=element('div'),button=element('button','Schutzschild: Einstellungen und Vorschau');button.onclick=()=>runtime?.open();node.append(button);return node;}}]
};
let runtime=null;
if(typeof window!=='undefined'&&typeof document!=='undefined'){
  // Hot reload replaces only our own runtime; removing/disabling the plugin takes effect on reload.
  window.__nextfloorAlarmShield?.dispose();runtime=new ShieldManager();window.__nextfloorAlarmShield=runtime;
  if(window.NextFloor)window.NextFloor.register(plugin);else(window.__nextfloorPlugins??=[]).push(plugin);
}
export { plugin };
