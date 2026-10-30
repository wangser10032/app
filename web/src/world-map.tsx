import React, {useEffect, useMemo, useState} from 'react';
import {MAP, LAND_ROWS} from './world-dots';

// 国家代码 → [经度, 纬度, 中文名]，用于把真实在售产品的国家标到地图上
export const COUNTRIES: Record<string, [number, number, string]> = {
  US: [-98, 39, '美国'], CA: [-79.4, 43.7, '加拿大'], MX: [-99.1, 19.4, '墨西哥'], BR: [-46.6, -23.5, '巴西'], AR: [-58.4, -34.6, '阿根廷'], CL: [-70.7, -33.4, '智利'], CO: [-74.1, 4.7, '哥伦比亚'],
  GB: [-0.1, 51.5, '英国'], IE: [-6.3, 53.3, '爱尔兰'], FR: [2.35, 48.9, '法国'], DE: [8.7, 50.1, '德国'], NL: [4.9, 52.4, '荷兰'], BE: [4.35, 50.85, '比利时'], ES: [-3.7, 40.4, '西班牙'], PT: [-9.1, 38.7, '葡萄牙'],
  IT: [12.5, 41.9, '意大利'], CH: [8.5, 47.4, '瑞士'], AT: [16.4, 48.2, '奥地利'], PL: [21, 52.2, '波兰'], SE: [18.1, 59.3, '瑞典'], NO: [10.75, 59.9, '挪威'], DK: [12.6, 55.7, '丹麦'], FI: [24.9, 60.2, '芬兰'],
  CZ: [14.4, 50.1, '捷克'], RO: [26.1, 44.4, '罗马尼亚'], UA: [30.5, 50.45, '乌克兰'], RU: [37.6, 55.75, '俄罗斯'], TR: [29, 41, '土耳其'], IL: [34.8, 32.1, '以色列'], AE: [55.3, 25.2, '阿联酋'], SA: [46.7, 24.7, '沙特阿拉伯'],
  EG: [31.2, 30, '埃及'], ZA: [28, -26.2, '南非'], NG: [3.4, 6.5, '尼日利亚'], KE: [36.8, -1.3, '肯尼亚'], IN: [77.2, 28.6, '印度'], PK: [67, 24.9, '巴基斯坦'], BD: [90.4, 23.8, '孟加拉国'],
  TH: [100.5, 13.75, '泰国'], VN: [106.7, 10.8, '越南'], MY: [101.7, 3.1, '马来西亚'], SG: [103.8, 1.35, '新加坡'], ID: [106.8, -6.2, '印度尼西亚'], PH: [121, 14.6, '菲律宾'],
  CN: [121.5, 31.2, '中国'], HK: [114.2, 22.3, '中国香港'], MO: [113.55, 22.2, '中国澳门'], TW: [121.5, 25, '中国台湾'], JP: [139.7, 35.7, '日本'], KR: [127, 37.55, '韩国'], AU: [151.2, -33.9, '澳大利亚'], NZ: [174.8, -36.85, '新西兰'],
};
export const countryName = (code: string) => COUNTRIES[code?.toUpperCase()]?.[2] || code || '不限地区';

// 没有真实库存时的示意出口，不标注地名
export const SAMPLE_EXITS: Array<[number, number]> = [[-118.2, 34], [-74, 40.7], [-0.1, 51.5], [8.7, 50.1], [139.7, 35.7], [103.8, 1.35], [-46.6, -23.5], [151.2, -33.9]];
export const HUB: [number, number] = [118, 31];

const project = ([lon, lat]: [number, number]) => [(lon - MAP.lon0) / MAP.step, (MAP.lat0 - lat) / MAP.step] as const;

function landPath() {
  let d = '';
  LAND_ROWS.forEach((row, r) => {
    let c = 0, land = false;
    for (const run of row.split('.')) {
      const n = parseInt(run, 36);
      if (land) for (let i = 0; i < n; i++) d += `M${c + i + .5} ${r + .5}h0`;
      c += n; land = !land;
    }
  });
  return d;
}

function arc(from: readonly [number, number], to: readonly [number, number]) {
  const [x1, y1] = from, [x2, y2] = to, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  const lift = Math.min(18, len * .32);
  const cx = (x1 + x2) / 2 + (dy / len) * lift * (dx > 0 ? 1 : -1), cy = (y1 + y2) / 2 - Math.abs(dx / len) * lift;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}Q${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => { const list = matchMedia(query); const change = () => setReduced(list.matches); list.addEventListener('change', change); return () => list.removeEventListener('change', change); }, []);
  return reduced;
}

export function WorldMap({countries = [], className = '', packets = true, visitor}: {countries?: string[]; className?: string; packets?: boolean; visitor?: [number, number] | null}) {
  const reduced = usePrefersReducedMotion();
  const land = useMemo(landPath, []);
  const id = useMemo(() => `m${Math.random().toString(36).slice(2, 8)}`, []);
  const exits = useMemo(() => {
    const real = [...new Set(countries.map(c => c.toUpperCase()))].filter(c => COUNTRIES[c]).map(c => ({key: c, point: project([COUNTRIES[c][0], COUNTRIES[c][1]])}));
    return real.length ? real : SAMPLE_EXITS.map((p, i) => ({key: `sample-${i}`, point: project(p)}));
  }, [countries.join(',')]);
  const hub = project(HUB), you = visitor ? project(visitor) : null;
  return <svg className={`rh-map ${className}`} viewBox={`0 0 ${MAP.cols} ${MAP.rows}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="ResiHub 网关与各地住宅出口节点的连接示意图">
    <defs>
      <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".45" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <radialGradient id={`${id}-hub`}><stop offset="0" stopColor="#5b84ff" stopOpacity=".55"/><stop offset="1" stopColor="#5b84ff" stopOpacity="0"/></radialGradient>
      {exits.map(({key, point}) => <linearGradient key={key} id={`${id}-${key}`} gradientUnits="userSpaceOnUse" x1={hub[0]} y1={hub[1]} x2={point[0]} y2={point[1]}><stop offset="0" stopColor="#7d9dff"/><stop offset="1" stopColor="#f2a93b"/></linearGradient>)}
    </defs>
    <path className="rh-map-land" d={land}/>
    <circle cx={hub[0]} cy={hub[1]} r={9} fill={`url(#${id}-hub)`}/>
    {you && <g className="rh-map-you"><path className="rh-map-you-arc" d={arc(you, hub)}/><circle className="rh-map-you-halo" cx={you[0]} cy={you[1]} r={2}/><circle className="rh-map-you-dot" cx={you[0]} cy={you[1]} r={.8}/></g>}
    {exits.map(({key, point}, i) => {
      const d = arc(hub, point);
      return <g key={key} className="rh-map-route" style={{'--i': i} as React.CSSProperties} filter={`url(#${id}-glow)`}>
        <path className="rh-map-arc" d={d} pathLength={1} stroke={`url(#${id}-${key})`}/>
        <circle className="rh-map-exit-halo" cx={point[0]} cy={point[1]} r={1.9}/>
        <circle className="rh-map-exit" cx={point[0]} cy={point[1]} r={.75}/>
        {packets && !reduced && <circle className="rh-map-packet" r={.42}><animateMotion dur={`${5.5 + (i % 4) * 1.3}s`} begin={`-${(i * 1.7) % 5}s`} repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="linear"/></circle>}
      </g>;
    })}
    <circle className="rh-map-hub-ring" cx={hub[0]} cy={hub[1]} r={2.4}/>
    <circle className="rh-map-hub" cx={hub[0]} cy={hub[1]} r={1}/>
  </svg>;
}
