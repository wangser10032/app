import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowsClockwise, CheckCircle, Plus, ArrowRight} from '@phosphor-icons/react';
import {api, money, type Product} from './api';
import {useAuth, Brand, CopyButton} from './ui';
import {countryName, usePrefersReducedMotion} from './world-map';
import {Globe} from './globe';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-sans-sc/900.css';
import './landing.css';

const faqs = [
  ['静态住宅 IP 和动态住宅 IP 有什么区别？', '动态住宅代理按请求或按时间轮换出口，适合大批量采集；静态住宅 IP 在租期内始终使用同一个家庭宽带出口，适合需要长期登录、保持账号环境一致的业务。ResiHub 只提供静态住宅 IP。'],
  ['购买后多久可以使用？', '下单成功的同时就会分配 IP 并生成独立的用户名和密码，在控制台「静态住宅 → 已购 IP」中复制即可立即使用。'],
  ['支持哪些协议？', 'HTTP、HTTPS 和 SOCKS5 都支持，并且使用同一个地址、端口和同一组用户名密码：HTTP 客户端选 HTTP 代理（HTTPS 网站自动走 CONNECT 隧道），SOCKS5 客户端选 SOCKS5 即可。'],
  ['一个 IP 可以在多台设备上同时使用吗？', '可以。同一账户下的所有 IP 共享并发连接上限，默认为 20 个连接；同一个 IP 不会再分配给其他用户。'],
  ['到期后 IP 会怎样？', '到期后连接立即停止。如果该 IP 尚未重新分配给其他用户，仍可续费恢复；为避免中断，建议在到期前续费，总览页会提示 7 天内到期的 IP。'],
  ['怎么确认代理已经生效？', '通过代理打开本站首页，「你当前的 IP」会显示代理的出口 IP 和所在地区；也可以用接入说明中的 curl 命令验证。'],
];

type Visitor = {ip: string; local?: boolean; country?: string; region?: string; city?: string; isp?: string; lat?: number | null; lon?: number | null};
const place = (parts: Array<string | undefined>) => [...new Set(parts.filter(Boolean))].join(' ');

function IpCheck({onLocate}: {onLocate: (point: [number, number] | null) => void}) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading'), [data, setData] = useState<Visitor | null>(null);
  const check = useCallback(() => {
    setState('loading');
    api<Visitor>('/ip').then(d => { setData(d); setState('ready'); onLocate(d.lat != null && d.lon != null ? [d.lon, d.lat] : null); }).catch(() => setState('failed'));
  }, [onLocate]);
  useEffect(check, [check]);
  const location = data?.local ? '本地或内网地址' : data?.country ? place([countryName(data.country), data.region, data.city]) : '未能识别';
  return <section className="rh-ipcheck" aria-live="polite" aria-label="当前 IP 检测">
    <div className="rh-ipcheck-head"><span className={`rh-live ${state === 'loading' ? 'is-busy' : ''}`}/>你当前的 IP<button type="button" onClick={check} disabled={state === 'loading'} aria-label="重新检测"><ArrowsClockwise size={15}/></button></div>
    <p className="rh-ipcheck-ip rh-num">{state === 'loading' ? '检测中…' : state === 'failed' ? '检测失败' : data?.ip}</p>
    <dl>
      <div><dt>归属地</dt><dd>{state === 'ready' ? location : '—'}</dd></div>
      <div><dt>运营商</dt><dd>{state === 'ready' ? data?.isp || '未能识别' : '—'}</dd></div>
    </dl>
  </section>;
}

// 首屏光效：缓慢漂移的极光、沿曲线流向地球的彩色光束、细微星尘。仅装饰，减少动态效果时静止。
const streaks = [
  'M-80 860 C 240 760, 560 640, 1010 450', 'M-60 700 C 260 640, 600 520, 1020 440', 'M-40 980 C 380 860, 700 700, 1030 470',
  'M120 -40 C 360 120, 700 300, 1000 420', 'M-80 360 C 300 360, 660 410, 1000 440', 'M420 980 C 600 760, 820 600, 1040 480',
];
function HeroEffects() {
  return <div className="rh-effects" aria-hidden="true">
    <div className="rh-aurora"><i/><i/><i/></div>
    <div className="rh-dust"/>
    <svg className="rh-streaks" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="rh-streak" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#2f6bff" stopOpacity="0"/><stop offset=".35" stopColor="#2f6bff"/><stop offset=".68" stopColor="#8b5cf6"/><stop offset="1" stopColor="#f59e0b"/></linearGradient></defs>
      {streaks.map((d, i) => <g key={i} style={{'--i': i} as React.CSSProperties}><path className="rh-streak" d={d} pathLength={1}/><path className="rh-streak-pulse" d={d} pathLength={1}/></g>)}
    </svg>
  </div>;
}

const sections = [['product', '产品'], ['access', '接入'], ['pricing', '价格'], ['faq', '常见问题']] as const;
function SectionNav() {
  const reduced = usePrefersReducedMotion(), nav = useRef<HTMLElement>(null), [active, setActive] = useState(''), [pill, setPill] = useState<{left: number; width: number} | null>(null);
  // 按滚动位置判断当前区块：取包含视口 40% 处那条线、且位置最靠下（最内层）的区块，嵌套的「接入」不会卡住
  useEffect(() => {
    const update = () => {
      const line = window.innerHeight * .4; let best = '', bestTop = -Infinity;
      for (const [id] of sections) { const rect = document.getElementById(id)?.getBoundingClientRect(); if (rect && rect.top <= line && rect.bottom > line && rect.top > bestTop) { best = id; bestTop = rect.top; } }
      setActive(best);
    };
    update(); window.addEventListener('scroll', update, {passive: true}); window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  useLayoutEffect(() => {
    const link = nav.current?.querySelector<HTMLAnchorElement>(`a[href="#${active}"]`);
    setPill(link ? {left: link.offsetLeft, width: link.offsetWidth} : null);
  }, [active]);
  const go = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id); if (!el) return;
    event.preventDefault(); setActive(id); el.scrollIntoView({behavior: reduced ? 'auto' : 'smooth', block: 'start'}); history.replaceState(null, '', `#${id}`);
  };
  return <nav ref={nav} aria-label="首页导航">
    <span className={`rh-nav-pill ${pill ? 'is-on' : ''}`} style={pill ? {translate: `${pill.left}px 0`, width: pill.width} : undefined} aria-hidden="true"/>
    {sections.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined} onClick={e => go(e, id)}>{label}</a>)}
  </nav>;
}

// 以下示例地址取自文档保留网段（RFC 5737），不对应任何真实主机
function ConsolePreview() {
  const rows = [['美国', '203.0.113.42', 27], ['日本', '203.0.113.88', 12], ['德国', '198.51.100.17', 4]] as const;
  return <div className="rh-window" aria-hidden="true">
    <div className="rh-window-bar"><i/><i/><i/><span>已购 IP</span></div>
    <table><thead><tr><th>国家</th><th>出口 IP</th><th>状态</th><th>剩余</th></tr></thead>
      <tbody>{rows.map(([country, ip, days]) => <tr key={ip}><td><b>{country}</b></td><td className="rh-num">{ip}</td><td><span className={`rh-pill ${days <= 7 ? 'is-warn' : ''}`}>{days <= 7 ? '即将到期' : '正常'}</span></td><td><span className="rh-num">{days}</span> 天</td></tr>)}</tbody>
    </table>
  </div>;
}

const protocols = [['http', 'HTTP'], ['https', 'HTTPS'], ['socks5', 'SOCKS5']] as const;
function ProtocolTerminal({gateway}: {gateway: string}) {
  const [protocol, setProtocol] = useState<typeof protocols[number][0]>('http');
  const scheme = protocol === 'socks5' ? 'socks5h' : 'http', target = protocol === 'http' ? 'http://api.ipify.org' : 'https://api.ipify.org';
  const command = `curl --proxy ${scheme}://${gateway} \\\n     --proxy-user 'sip_用户名:密码' \\\n     ${target}`;
  return <figure className="rh-terminal">
    <figcaption><div className="rh-tabs" role="tablist" aria-label="接入协议">{protocols.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={protocol === key} onClick={() => setProtocol(key)}>{label}</button>)}</div><CopyButton value={command}/></figcaption>
    <pre><code><span className="rh-c">$ </span>{command}{'\n\n'}<span className="rh-o">203.0.113.42</span></code></pre>
  </figure>;
}

function RenewalVisual() {
  return <div className="rh-renew" aria-hidden="true">
    <div className="rh-renew-head"><span className="rh-num">203.0.113.42</span><em>美国</em></div>
    <div className="rh-renew-track"><span className="rh-renew-used"/><span className="rh-renew-left"/><span className="rh-renew-add"/></div>
    <div className="rh-renew-scale"><span>购买</span><span style={{left: '44%'}}>今天</span><span style={{left: '67%'}}>原到期日</span><span>续费后</span></div>
    <div className="rh-renew-foot"><CheckCircle size={18} weight="fill"/>续费后 IP、用户名和密码保持不变</div>
  </div>;
}

export function Landing() {
  const {user} = useAuth();
  const [products, setProducts] = useState<Product[] | null>(null), [failed, setFailed] = useState(false), [visitor, setVisitor] = useState<[number, number] | null>(null), [scrolled, setScrolled] = useState(false), [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { api<{items: Product[]}>('/static-products').then(d => setProducts(d.items)).catch(() => setFailed(true)); }, []);
  useEffect(() => { const on = () => setScrolled(window.scrollY > 12); on(); window.addEventListener('scroll', on, {passive: true}); return () => window.removeEventListener('scroll', on); }, []);
  // 标题字形加载完成后再显示，避免先用系统字体渲染、再切换字体的闪烁；最多等待 1.2 秒
  useEffect(() => {
    let done = false; const ready = () => { if (!done) { done = true; setFontsReady(true); } };
    const timer = setTimeout(ready, 1200);
    const fonts = document.fonts;
    if (fonts?.load) Promise.all([fonts.load('900 64px "Noto Sans SC"', '租期内，出口始终是同一个'), fonts.load('900 64px "Archivo Variable"', 'IP')]).then(ready, ready); else ready();
    return () => clearTimeout(timer);
  }, []);
  const countries = (products || []).filter(p => p.available_ips > 0).map(p => p.country).filter(Boolean);
  const gateway = `${window.location.hostname}:3128`;
  const buyLink = user ? '/app/static' : '/register';
  return <div className="rh-landing">
    <header className={`rh-nav ${scrolled ? 'is-scrolled' : ''}`}>
      <Brand/>
      <SectionNav/>
      <div className="rh-nav-actions">{user ? <Link viewTransition className="rh-btn rh-btn-light" to="/app">进入控制台</Link> : <><Link viewTransition className="rh-nav-login" to="/login">登录</Link><Link viewTransition className="rh-btn rh-btn-light" to="/register">免费注册</Link></>}</div>
    </header>

    <section className={`rh-hero ${fontsReady ? 'is-ready' : ''}`} id="home">
      <HeroEffects/>
      <div className="rh-hero-copy">
        <h1>租期内，<br/><span className="rh-keep">出口始终是</span><br/><span className="rh-keep rh-hero-em">同一个 IP</span></h1>
        <p>每个 IP 只分配给一位用户，按数量和天数购买。HTTP、HTTPS、SOCKS5 同一地址接入，续费后保留原 IP 和凭据。</p>
        <div className="rh-hero-actions">
          <Link viewTransition className="rh-btn rh-btn-primary rh-btn-lg" to={user ? '/app/static' : '/register'}>{user ? '购买静态 IP' : '免费注册'}<ArrowRight size={18} weight="bold"/></Link>
          <a className="rh-btn rh-btn-ghost rh-btn-lg" href="#pricing">查看价格</a>
        </div>
        <ul className="rh-hero-points"><li><CheckCircle size={18} weight="fill"/>独享 IP</li><li><CheckCircle size={18} weight="fill"/>租期内不更换</li><li><CheckCircle size={18} weight="fill"/>HTTP / HTTPS / SOCKS5</li></ul>
      </div>
      <div className="rh-hero-visual">
        <Globe theme="light" countries={countries} visitor={visitor}/>
        <IpCheck onLocate={setVisitor}/>
      </div>
    </section>

    <section className="rh-section rh-rows" id="product">
      <div className="rh-row">
        <div className="rh-row-copy"><h2>每个 IP 只属于你一个人</h2><p>静态住宅 IP 来自真实家庭宽带。下单后系统为你独占分配，租期内不会转给其他用户，也不会轮换或在故障时换成别的出口。</p><ul><li><CheckCircle size={18} weight="fill"/>跨境电商店铺固定使用当地 IP 登录</li><li><CheckCircle size={18} weight="fill"/>社媒账号长期保持同一网络环境</li><li><CheckCircle size={18} weight="fill"/>到期前 7 天在控制台提醒续费</li></ul></div>
        <div className="rh-row-visual"><ConsolePreview/></div>
      </div>
      <div className="rh-row is-flip" id="access">
        <div className="rh-row-copy"><h2><span className="rh-keep">HTTP、HTTPS、SOCKS5</span><br/>一个地址全部支持</h2><p>每个 IP 有独立的用户名和密码。浏览器、指纹浏览器、爬虫框架和 curl 都能直接配置，也可以按「地址:端口:用户名:密码」批量导出。</p><ul><li><CheckCircle size={18} weight="fill"/>同一组凭据适用三种协议</li><li><CheckCircle size={18} weight="fill"/>访问 HTTPS 网站自动走 CONNECT 隧道</li><li><CheckCircle size={18} weight="fill"/>SOCKS5 支持远程解析域名</li></ul></div>
        <div className="rh-row-visual"><ProtocolTerminal gateway={gateway}/></div>
      </div>
      <div className="rh-row">
        <div className="rh-row-copy"><h2>续费顺延租期，IP 不变</h2><p>续费从原到期时间往后顺延，出口 IP、用户名和密码全部保留，不需要重新配置任何工具。</p><ul><li><CheckCircle size={18} weight="fill"/>支付宝、微信充值，余额实时到账</li><li><CheckCircle size={18} weight="fill"/>按 IP 数量和天数计费，不限流量</li><li><CheckCircle size={18} weight="fill"/>续费记录在订单与账单中可查</li></ul></div>
        <div className="rh-row-visual"><RenewalVisual/></div>
      </div>
    </section>

    <section className="rh-section rh-pricing" id="pricing">
      <div className="rh-section-head"><h2>价格</h2><p>按每个 IP、每个租期计价，可售数量为当前空闲 IP 的实时数量。</p></div>
      {failed ? <p className="rh-empty">价格暂时无法加载，请刷新页面重试。</p>
        : products === null ? <p className="rh-empty">正在加载价格…</p>
        : products.length === 0 ? <div className="rh-empty"><strong>首批 IP 正在上架</strong><p>现在注册账号，上架后即可在控制台直接购买。</p><Link viewTransition className="rh-btn rh-btn-primary" to={buyLink}>{user ? '前往控制台' : '免费注册'}</Link></div>
        : <div className="rh-table-wrap"><table className="rh-price-table">
          <thead><tr><th scope="col">产品</th><th scope="col">国家</th><th scope="col">租期</th><th scope="col">价格 / IP</th><th scope="col">可售</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
          <tbody>{products.map(p => <tr key={p.id}>
            <th scope="row">{p.name}</th><td>{countryName(p.country)}</td><td><span className="rh-num">{p.duration_days}</span> 天</td>
            <td className="rh-price"><span className="rh-num">{money(p.price_cents)}</span></td>
            <td>{p.available_ips > 0 ? <span className="rh-num">{p.available_ips}</span> : <span className="rh-soldout">已售完</span>}</td>
            <td>{p.available_ips > 0 ? <Link viewTransition className="rh-buy" to={buyLink}>购买</Link> : <span className="rh-buy rh-buy-off">补货中</span>}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>

    <section className="rh-section rh-faq" id="faq">
      <div className="rh-section-head"><h2>常见问题</h2></div>
      <div className="rh-faq-list">{faqs.map(([q, a]) => <details key={q}><summary>{q}<Plus size={18} weight="bold"/></summary><p>{a}</p></details>)}</div>
    </section>

    <section className="rh-cta">
      <div><h2>先注册，再按需购买</h2><p>注册免费，不购买不扣费。余额只用于购买和续费 IP。</p></div>
      <Link viewTransition className="rh-btn rh-btn-primary rh-btn-lg" to={user ? '/app' : '/register'}>{user ? '进入控制台' : '免费注册'}<ArrowRight size={18} weight="bold"/></Link>
    </section>

    <footer className="rh-footer">
      <div className="rh-footer-brand"><Brand/><p>静态住宅代理。独享 IP，租期内出口不变。</p></div>
      <nav aria-label="产品"><h4>产品</h4><a href="#product">静态住宅 IP</a><a href="#pricing">价格</a></nav>
      <nav aria-label="帮助"><h4>帮助</h4><a href="#access">接入方式</a><a href="#faq">常见问题</a></nav>
      <nav aria-label="账户"><h4>账户</h4><Link viewTransition to="/login">登录</Link><Link viewTransition to="/register">免费注册</Link><Link viewTransition to="/forgot">找回密码</Link></nav>
      <small>© {new Date().getFullYear()} ResiHub</small>
    </footer>
  </div>;
}
