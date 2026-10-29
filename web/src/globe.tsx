import React, {useEffect, useMemo, useRef} from 'react';
import {MAP, LAND_ROWS} from './world-dots';
import {COUNTRIES, SAMPLE_EXITS, HUB, usePrefersReducedMotion} from './world-map';

// 正射投影的点阵地球：网关 → 出口节点的弧线沿大圆抬升，可拖动旋转；离屏或标签页隐藏时暂停绘制。
type LonLat = [number, number];
const RAD = Math.PI / 180;
const toVec = ([lon, lat]: LonLat) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const toLonLat = ([x, y, z]: number[]): LonLat => [Math.atan2(y, x) / RAD, Math.asin(Math.max(-1, Math.min(1, z))) / RAD];

function landDots() {
  const out: LonLat[] = [];
  LAND_ROWS.forEach((row, r) => {
    let c = 0, land = false;
    for (const run of row.split('.')) { const n = parseInt(run, 36); if (land) for (let i = 0; i < n; i++) out.push([MAP.lon0 + (c + i + .5) * MAP.step, MAP.lat0 - r * MAP.step]); c += n; land = !land; }
  });
  return out;
}

function greatArc(a: LonLat, b: LonLat, samples = 48) {
  const va = toVec(a), vb = toVec(b), dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2], w = Math.acos(Math.max(-1, Math.min(1, dot))), s = Math.sin(w) || 1, lift = .05 + .22 * (w / Math.PI);
  return Array.from({length: samples + 1}, (_, i) => {
    const t = i / samples, k1 = Math.sin((1 - t) * w) / s, k2 = Math.sin(t * w) / s;
    return {p: toLonLat([k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]]), h: 1 + lift * Math.sin(Math.PI * t)};
  });
}

export function Globe({countries = [], visitor, className = ''}: {countries?: string[]; visitor?: LonLat | null; className?: string}) {
  const canvas = useRef<HTMLCanvasElement>(null), reduced = usePrefersReducedMotion();
  const dots = useMemo(landDots, []);
  const exits = useMemo(() => {
    const real = [...new Set(countries.map(c => c.toUpperCase()))].filter(c => COUNTRIES[c]).map(c => [COUNTRIES[c][0], COUNTRIES[c][1]] as LonLat);
    return real.length ? real : SAMPLE_EXITS;
  }, [countries.join(',')]);
  const arcs = useMemo(() => exits.map(e => greatArc(HUB, e)), [exits]);
  const visitorArc = useMemo(() => visitor ? greatArc(visitor, HUB, 24) : null, [visitor?.[0], visitor?.[1]]);
  const view = useRef({lon: 98, lat: 22, drag: null as null | {x: number; y: number; lon: number; lat: number}, idleAt: 0});

  useEffect(() => {
    const el = canvas.current!, ctx = el.getContext('2d')!;
    let raf = 0, visible = true, start = performance.now(), last = start, w = 0, h = 0, dpr = 1;
    const resize = () => { dpr = Math.min(2, window.devicePixelRatio || 1); w = el.clientWidth; h = el.clientHeight; el.width = w * dpr; el.height = h * dpr; draw(performance.now()); };
    function project([lon, lat]: LonLat, height = 1) {
      const v = view.current, l = lon * RAD, p = lat * RAD, l0 = v.lon * RAD, p0 = v.lat * RAD;
      const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l - l0);
      const x = Math.cos(p) * Math.sin(l - l0) * height, y = (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l - l0)) * height;
      return {x, y, z: cosc, hidden: cosc < 0 && Math.hypot(x, y) < 1};
    }
    function draw(now: number) {
      const t = (now - start) / 1000, R = Math.min(w, h) * .37, cx = w / 2, cy = h / 2, intro = reduced ? 1 : Math.min(1, Math.max(0, (t - .3) / 1.6));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      // 大气层与球体
      const atmo = ctx.createRadialGradient(cx, cy, R * .92, cx, cy, R * 1.32);
      atmo.addColorStop(0, 'rgba(76,124,255,.38)'); atmo.addColorStop(.35, 'rgba(76,124,255,.12)'); atmo.addColorStop(1, 'rgba(76,124,255,0)');
      ctx.fillStyle = atmo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.32, 0, Math.PI * 2); ctx.fill();
      const body = ctx.createRadialGradient(cx - R * .35, cy - R * .4, R * .1, cx, cy, R);
      body.addColorStop(0, '#1b3560'); body.addColorStop(.7, '#0d1d36'); body.addColorStop(1, '#0a1730');
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(140,175,255,.35)'; ctx.lineWidth = 1; ctx.stroke();
      // 陆地点阵：按深度分 4 档批量绘制
      const buckets: number[][] = [[], [], [], []];
      for (const d of dots) { const q = project(d); if (q.z <= 0) continue; const b = Math.min(3, Math.floor(q.z * 4)); buckets[b].push(cx + q.x * R, cy - q.y * R); }
      buckets.forEach((pts, b) => {
        ctx.fillStyle = `rgba(122,160,255,${.18 + b * .2})`; const size = (.75 + b * .2) * Math.max(1, R / 260);
        ctx.beginPath(); for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i] + size, pts[i + 1]); ctx.arc(pts[i], pts[i + 1], size, 0, Math.PI * 2); } ctx.fill();
      });
      // 航线
      const strokeArc = (path: ReturnType<typeof greatArc>, upto: number, colors: [string, string], width: number) => {
        const a = project(path[0].p, path[0].h), b = project(path[path.length - 1].p, path[path.length - 1].h);
        const g = ctx.createLinearGradient(cx + a.x * R, cy - a.y * R, cx + b.x * R, cy - b.y * R); g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
        ctx.strokeStyle = g; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath(); let pen = false;
        const n = Math.floor((path.length - 1) * upto);
        for (let i = 0; i <= n; i++) { const q = project(path[i].p, path[i].h); if (q.hidden) { pen = false; continue; } const X = cx + q.x * R, Y = cy - q.y * R; if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; } }
        ctx.stroke();
      };
      ctx.save(); ctx.shadowColor = 'rgba(125,157,255,.9)'; ctx.shadowBlur = 10;
      arcs.forEach((path, i) => strokeArc(path, Math.min(1, Math.max(0, intro * 1.6 - i * .08)), ['rgba(125,157,255,.95)', 'rgba(242,169,59,.95)'], 1.5));
      if (visitorArc) strokeArc(visitorArc, intro, ['rgba(94,224,200,.9)', 'rgba(125,157,255,.9)'], 1.2);
      ctx.restore();
      const pin = (p: LonLat, color: string, r: number, halo: number) => {
        const q = project(p); if (q.z <= 0) return; const X = cx + q.x * R, Y = cy - q.y * R;
        ctx.fillStyle = color.replace('1)', `${.22 * q.z})`); ctx.beginPath(); ctx.arc(X, Y, r * halo, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
      };
      if (intro > .5) exits.forEach(e => pin(e, 'rgba(242,169,59,1)', 3, 3));
      if (visitor) pin(visitor, 'rgba(94,224,200,1)', 3.2, 3.4);
      pin(HUB, 'rgba(255,255,255,1)', 4, 3.2);
      // 网关光环与数据包
      if (!reduced) {
        const hq = project(HUB);
        if (hq.z > 0) { const k = (t % 2.6) / 2.6; ctx.strokeStyle = `rgba(255,255,255,${.6 * (1 - k)})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx + hq.x * R, cy - hq.y * R, 5 + k * 22, 0, Math.PI * 2); ctx.stroke(); }
        if (intro >= 1) arcs.forEach((path, i) => {
          const f = ((t * .22 + i * .37) % 1) * (path.length - 1), j = Math.floor(f), s = path[j], e = path[Math.min(path.length - 1, j + 1)], m = f - j;
          const va = toVec(s.p), vb = toVec(e.p), q = project(toLonLat(va.map((x, k) => x + (vb[k] - x) * m)), s.h + (e.h - s.h) * m); if (q.hidden) return;
          ctx.save(); ctx.shadowColor = '#fff'; ctx.shadowBlur = 12; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx + q.x * R, cy - q.y * R, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        });
      }
    }
    function frame(now: number) {
      const v = view.current, dt = Math.min(.05, (now - last) / 1000); last = now;
      if (!reduced && !v.drag && now > v.idleAt) v.lon = (v.lon + dt * 6) % 360;
      draw(now); if (visible && !reduced) raf = requestAnimationFrame(frame);
    }
    const play = () => { cancelAnimationFrame(raf); last = performance.now(); if (reduced) draw(last); else raf = requestAnimationFrame(frame); };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; if (visible) play(); else cancelAnimationFrame(raf); });
    const onVisibility = () => { visible = !document.hidden; if (visible) play(); else cancelAnimationFrame(raf); };
    const down = (e: PointerEvent) => { const v = view.current; v.drag = {x: e.clientX, y: e.clientY, lon: v.lon, lat: v.lat}; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { const v = view.current; if (!v.drag) return; v.lon = v.drag.lon - (e.clientX - v.drag.x) * .35; v.lat = Math.max(-10, Math.min(50, v.drag.lat + (e.clientY - v.drag.y) * .25)); if (reduced) draw(performance.now()); };
    const up = () => { const v = view.current; v.drag = null; v.idleAt = performance.now() + 1500; };
    const ro = new ResizeObserver(resize); ro.observe(el); io.observe(el);
    document.addEventListener('visibilitychange', onVisibility);
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    resize(); play();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVisibility); el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }, [dots, arcs, visitorArc, exits, visitor?.[0], visitor?.[1], reduced]);

  return <canvas ref={canvas} className={`rh-globe ${className}`} role="img" aria-label="ResiHub 网关与各地住宅出口节点的连接示意地球，可拖动旋转"/>;
}
