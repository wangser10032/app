import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowsClockwise, Storefront, ChatsCircle, MegaphoneSimple, Translate, ShieldCheck, Funnel, DownloadSimple, CheckCircle, Plus, CaretDown} from '@phosphor-icons/react';
import {api, money, type Product} from './api';
import {useAuth, Brand} from './ui';
import {countryName, usePrefersReducedMotion} from './world-map';
import {Globe} from './globe';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-sans-sc/900.css';
import './landing.css';

const useCases = [
  {icon: Storefront, title: '跨境电商店铺', text: '每个店铺固定使用一个当地住宅 IP 登录后台，避免因 IP 频繁变化触发风控。'},
  {icon: ChatsCircle, title: '社交媒体运营', text: '账号长期在同一地区、同一家庭宽带环境下使用，登录记录前后一致。'},
  {icon: MegaphoneSimple, title: '广告投放核验', text: '以目标地区普通用户的网络查看广告是否按预期展示。'},
  {icon: Translate, title: '本地化与价格检查', text: '以当地宽带身份访问网站，核对地区内容、语言与定价。'},
];

const steps = [
  ['充值余额', '支持支付宝、微信扫码充值，余额实时到账。'],
  ['选择地区与数量', '按国家、地区和运营商挑选产品，一次最多购买 100 个 IP。'],
  ['复制接入信息', '每个 IP 都有独立的用户名和密码，可复制或批量导出。'],
  ['到期前续费', '续费在原到期时间上顺延，IP 和凭据保持不变。'],
];

const faqs = [
  ['静态住宅 IP 和动态住宅 IP 有什么区别？', '动态住宅代理按请求或按时间轮换出口，适合大批量采集；静态住宅 IP 在租期内始终使用同一个家庭宽带出口，适合需要长期登录、保持账号环境一致的业务。ResiHub 只提供静态住宅 IP。'],
  ['购买后多久可以使用？', '下单成功的同时就会分配 IP 并生成独立的用户名和密码，在控制台「静态住宅 → 已购 IP」中复制即可立即使用。'],
  ['支持哪些协议？', 'HTTP、HTTPS 和 SOCKS5 都支持，并且使用同一个地址、端口和同一组用户名密码：HTTP 客户端选 HTTP 代理（HTTPS 网站自动走 CONNECT 隧道），SOCKS5 客户端选 SOCKS5 即可。浏览器、指纹浏览器、curl 以及常见爬虫框架都可以直接配置。'],
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
      <div><dt>位置</dt><dd>{state === 'ready' ? location : '—'}</dd></div>
      <div><dt>运营商</dt><dd>{state === 'ready' ? data?.isp || '未能识别' : '—'}</dd></div>
    </dl>
    <p className="rh-ipcheck-note">通过 ResiHub 代理打开本页时，这里显示的就是代理的出口 IP。</p>
  </section>;
}

// 示例地址取自文档保留网段（RFC 5737），不对应任何真实主机
function ConsolePreview() {
  const rows = [['美国', '203.0.113.42', 27], ['日本', '203.0.113.88', 12], ['德国', '198.51.100.17', 4]] as const;
  return <div className="rh-window" aria-hidden="true">
    <div className="rh-window-bar"><i/><i/><i/><span>控制台 · 已购 IP</span><em>示例</em></div>
    <table><thead><tr><th>国家</th><th>出口 IP</th><th>状态</th><th>剩余</th></tr></thead>
      <tbody>{rows.map(([country, ip, days]) => <tr key={ip}><td><b>{country}</b></td><td className="rh-num">{ip}</td><td><span className={`rh-pill ${days <= 7 ? 'is-warn' : ''}`}>{days <= 7 ? '即将到期' : '正常'}</span></td><td><span className="rh-num">{days}</span> 天</td></tr>)}</tbody>
    </table>
  </div>;
}

const sections = [['product', '产品'], ['features', '功能'], ['pricing', '价格'], ['access', '接入'], ['faq', '常见问题']] as const;

// 导航：点击平滑滚动到对应区块，高亮块随当前区块滑动
function SectionNav() {
  const reduced = usePrefersReducedMotion(), nav = useRef<HTMLElement>(null), [active, setActive] = useState(''), [pill, setPill] = useState<{left: number; width: number} | null>(null);
  useEffect(() => {
    const io = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) setActive(e.target.id); }, {rootMargin: '-45% 0px -50% 0px'});
    sections.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    const top = () => { if (window.scrollY < window.innerHeight * .4) setActive(''); };
    window.addEventListener('scroll', top, {passive: true}); return () => { io.disconnect(); window.removeEventListener('scroll', top); };
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

export function Landing() {
  const {user} = useAuth();
  const [products, setProducts] = useState<Product[] | null>(null), [failed, setFailed] = useState(false), [visitor, setVisitor] = useState<[number, number] | null>(null), [scrolled, setScrolled] = useState(false);
  useEffect(() => { api<{items: Product[]}>('/static-products').then(d => setProducts(d.items)).catch(() => setFailed(true)); }, []);
  useEffect(() => { const on = () => setScrolled(window.scrollY > 12); on(); window.addEventListener('scroll', on, {passive: true}); return () => window.removeEventListener('scroll', on); }, []);
  const countries = (products || []).filter(p => p.available_ips > 0).map(p => p.country).filter(Boolean);
  const gateway = `${window.location.hostname}:3128`;
  const buyLink = user ? '/app/static' : '/register';
  return <div className="rh-landing">
    <header className={`rh-nav ${scrolled ? 'is-scrolled' : ''}`}>
      <Brand/>
      <SectionNav/>
      <div className="rh-nav-actions">{user ? <Link viewTransition className="rh-btn rh-btn-light" to="/app">进入控制台</Link> : <><Link viewTransition className="rh-nav-login" to="/login">登录</Link><Link viewTransition className="rh-btn rh-btn-light" to="/register">免费注册</Link></>}</div>
    </header>

    <section className="rh-hero">
      <div className="rh-hero-copy">
        <h1>租期内，<br/><span className="rh-keep">出口始终是</span><br/><span className="rh-keep rh-hero-em">同一个 IP</span></h1>
        <p>ResiHub 提供静态住宅代理。每个 IP 只分配给一位用户，按数量和天数购买，支持 HTTP、HTTPS 与 SOCKS5 接入；续费后保留原来的 IP 和凭据。</p>
        <div className="rh-hero-actions">
          <Link viewTransition className="rh-btn rh-btn-primary rh-btn-lg" to={user ? '/app/static' : '/register'}>{user ? '购买静态 IP' : '免费注册'}</Link>
          <a className="rh-btn rh-btn-ghost rh-btn-lg" href="#pricing">查看价格</a>
        </div>
        <ul className="rh-hero-points"><li><CheckCircle size={18} weight="fill"/>独享 IP</li><li><CheckCircle size={18} weight="fill"/>租期内不更换</li><li><CheckCircle size={18} weight="fill"/>HTTP / HTTPS / SOCKS5</li></ul>
      </div>
      <div className="rh-hero-visual">
        <Globe countries={countries} visitor={visitor}/>
        <IpCheck onLocate={setVisitor}/>
      </div>
    </section>

    <section className="rh-section rh-features" id="features">
      <div className="rh-section-head is-center"><h2>从下单到接入，都在一个控制台里完成</h2><p>购买、查看凭据、导出和续费，不需要联系客服。</p></div>
      <div className="rh-bento">
        <article className="rh-tile rh-tile-wide"><div className="rh-tile-copy"><h3>所有 IP 一目了然</h3><p>地区、出口地址、状态和剩余天数集中展示，7 天内到期的 IP 会在总览中提醒。</p></div><ConsolePreview/></article>
        <article className="rh-tile rh-tile-secure"><div className="rh-shield"><ShieldCheck size={34} weight="duotone"/></div><h3>凭据加密保存</h3><p>每个 IP 的代理密码单独生成并加密存储，只有你本人可以查看；网关会拦截访问内网和保留地址的请求。</p></article>
        <article className="rh-tile"><Funnel size={24} weight="duotone"/><h3>按国家挑选</h3><p>选择需要的国家即可下单，可售数量按空闲 IP 实时计算。</p><div className="rh-select" aria-hidden="true"><span>全部国家</span><CaretDown size={14} weight="bold"/></div></article>
        <article className="rh-tile"><DownloadSimple size={24} weight="duotone"/><h3>一键导出</h3><p>按「地址:端口:用户名:密码」格式批量导出，直接导入你的工具。</p><pre className="rh-export" aria-hidden="true">{`${gateway}:sip_3f2a…:••••••\n${gateway}:sip_9c1e…:••••••`}</pre></article>
        <article className="rh-tile"><ArrowsClockwise size={24} weight="duotone"/><h3>续费保留原 IP</h3><p>续费从原到期时间往后顺延，IP 和凭据都不变。</p><div className="rh-renew" aria-hidden="true"><div><span style={{width: '86%'}}/></div><small><b className="rh-num">26</b> / 30 天</small><em><Plus size={12} weight="bold"/>30 天</em></div></article>
      </div>
    </section>

    <section className="rh-section rh-product" id="product">
      <div className="rh-section-head"><h2>适合需要稳定网络身份的业务</h2><p>静态住宅 IP 来自真实家庭宽带。对平台来说，它就像一位一直在同一个地方上网的普通用户。</p></div>
      <ul className="rh-cases">{useCases.map(({icon: Icon, title, text}) => <li key={title}><span className="rh-case-icon"><Icon size={22}/></span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ul>
    </section>

    <section className="rh-section rh-pricing" id="pricing">
      <div className="rh-section-head is-center"><h2>价格</h2><p>按每个 IP、每个租期计价。可售数量是当前空闲节点的实时数量。</p></div>
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

    <section className="rh-section rh-access" id="access">
      <div className="rh-access-copy">
        <h2>用你熟悉的工具接入</h2>
        <p>购买后在控制台查看代理地址、端口、用户名和密码。同一个地址同时支持 HTTP、HTTPS 和 SOCKS5，浏览器、指纹浏览器、爬虫框架都能直接使用。</p>
        <ol className="rh-steps">{steps.map(([title, text]) => <li key={title}><h3>{title}</h3><p>{text}</p></li>)}</ol>
      </div>
      <figure className="rh-terminal">
        <figcaption>命令行示例</figcaption>
        <pre><code><span className="rh-c">{'# HTTP / HTTPS'}</span>{'\n'}curl --proxy http://{gateway} \{'\n'}     --proxy-user <span className="rh-s">'sip_用户名:密码'</span> \{'\n'}     https://api.ipify.org{'\n\n'}<span className="rh-c">{'# SOCKS5'}</span>{'\n'}curl --proxy socks5h://{gateway} \{'\n'}     --proxy-user <span className="rh-s">'sip_用户名:密码'</span> \{'\n'}     https://api.ipify.org{'\n\n'}<span className="rh-c">{'# 两种方式返回的都是同一个出口 IP'}</span>{'\n'}<span className="rh-o">203.0.113.42</span></code></pre>
      </figure>
    </section>

    <section className="rh-section rh-faq" id="faq">
      <div className="rh-section-head is-center"><h2>常见问题</h2></div>
      <div className="rh-faq-list">{faqs.map(([q, a]) => <details key={q}><summary>{q}<Plus size={18} weight="bold"/></summary><p>{a}</p></details>)}</div>
    </section>

    <section className="rh-cta">
      <div><h2>先注册，再按需购买</h2><p>注册免费，不购买不扣费。余额只用于购买和续费 IP。</p></div>
      <Link viewTransition className="rh-btn rh-btn-primary rh-btn-lg" to={user ? '/app' : '/register'}>{user ? '进入控制台' : '免费注册'}</Link>
    </section>

    <footer className="rh-footer">
      <div className="rh-footer-brand"><Brand/><p>静态住宅代理。独享 IP，租期内出口不变。</p></div>
      <nav aria-label="产品"><h4>产品</h4><a href="#product">静态住宅 IP</a><a href="#features">功能</a><a href="#pricing">价格</a></nav>
      <nav aria-label="帮助"><h4>帮助</h4><a href="#access">接入方式</a><a href="#faq">常见问题</a></nav>
      <nav aria-label="账户"><h4>账户</h4><Link viewTransition to="/login">登录</Link><Link viewTransition to="/register">免费注册</Link><Link viewTransition to="/forgot">找回密码</Link></nav>
      <small>© {new Date().getFullYear()} ResiHub</small>
    </footer>
  </div>;
}
