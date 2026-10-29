import React, {useState, useEffect, useRef, type FormEvent} from 'react';
import {Link, Navigate, useNavigate, useSearchParams} from 'react-router-dom';
import {ArrowRight, ArrowUpRight, EnvelopeSimple, LockKey, WarningCircle, Check, ArrowsClockwise, Wallet, Eye, EyeSlash} from '@phosphor-icons/react';
import {api, money, date, message} from './api';
import {useAuth, useToast, useResource, useWorkspace, passwordIssue, Brand, Heading, Loading, ErrorState, Empty, Badge, Modal} from './ui';
import {WorldMap} from './world-map';
import './account-polish.css';
import './landing.css';

// Both live payment providers create codes with a 30 minute payment window.
// This controls the cashier only; the server remains authoritative for payment status.
const PAYMENT_WINDOW_MS = 30 * 60 * 1000;
const paymentCodeExpiry = (payment: any) => Number(payment?.created_at) + PAYMENT_WINDOW_MS;

export function AuthPage({kind}: {kind: 'login' | 'register' | 'forgot'}) {
  const auth = useAuth(), nav = useNavigate(), toast = useToast();
  const [tab, setTab] = useState('password'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState(''), [nickname, setNickname] = useState(''), [remember, setRemember] = useState(true), [busy, setBusy] = useState(false), [sending, setSending] = useState(false), [cooldown, setCooldown] = useState(0), [error, setError] = useState(''), [devCode, setDevCode] = useState(''), [showPassword, setShowPassword] = useState(false);
  useEffect(() => {setError(''); setCode(''); setPassword(''); setDevCode(''); setShowPassword(false);}, [kind]);
  useEffect(() => {if (!cooldown) return; const timer = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(timer);}, [cooldown]);
  if (auth.ready && auth.user && kind !== 'forgot') return <Navigate to="/app" replace/>;
  const title = kind === 'register' ? '创建账号' : kind === 'forgot' ? '重置密码' : '登录账号';
  async function sendCode() {
    setSending(true); setError('');
    try {
      const data = await api('/auth/send-code', 'POST', {email, purpose: kind === 'register' ? 'register' : kind === 'forgot' ? 'reset' : 'login'});
      setCooldown(60); setDevCode(data.dev_code || ''); toast(data.dev_code ? '开发验证码已生成' : '验证码已发送，请检查邮箱。');
    } catch (e) {setError(message(e));} finally {setSending(false);}
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if ((kind !== 'login' || tab === 'password') && passwordIssue(password)) {setError(passwordIssue(password)); return;}
    setBusy(true); setError('');
    try {
      if (kind === 'forgot') {
        await api('/auth/reset-password', 'POST', {email, code, password}); toast('密码已重置，请重新登录。'); auth.logout(); nav('/login');
      } else {
        const data = await api(kind === 'register' ? '/auth/register' : tab === 'code' ? '/auth/login-code' : '/auth/login', 'POST', {email, password, code, nickname, remember});
        auth.accept(data); nav('/app');
      }
    } catch (e) {setError(message(e));} finally {setBusy(false);}
  }
  const needsCode = kind !== 'login' || tab === 'code';
  const needsPassword = kind !== 'login' || tab === 'password';
  const lead = kind === 'register' ? '只需一个邮箱。验证码会发送到你填写的地址。' : kind === 'forgot' ? '验证注册邮箱后，设置新的登录密码。' : '登录后管理已购 IP、订单和余额。';
  const switchTab = (next: string) => {setTab(next); setError('');};
  return <div className="rh-auth">
    <div className="rh-auth-card">
      <aside className="rh-auth-side">
        <Brand/>
        <div className="rh-auth-pitch">
          <h2>租期内，<br/><span className="rh-keep">出口始终是同一个 IP</span></h2>
          <ul>
            <li><Check size={16} weight="bold"/>独享静态住宅 IP，不与他人共用</li>
            <li><Check size={16} weight="bold"/>按 IP 数量和天数计费，续费保留原 IP</li>
            <li><Check size={16} weight="bold"/>支付宝、微信充值，余额实时到账</li>
          </ul>
        </div>
        <WorldMap className="rh-auth-map"/>
      </aside>
      <main className="rh-auth-main">
        <div className="rh-auth-mobile-brand"><Brand/></div>
        <h1>{title}</h1>
        <p className="rh-auth-lead">{lead}</p>
        {kind === 'login' && <div className="rh-segment" role="tablist" aria-label="登录方式">
          <button type="button" role="tab" aria-selected={tab === 'password'} onClick={() => switchTab('password')}>密码登录</button>
          <button type="button" role="tab" aria-selected={tab === 'code'} onClick={() => switchTab('code')}>验证码登录</button>
        </div>}
        <form onSubmit={submit} className="rh-auth-form">
          <div className="rh-field"><label htmlFor="email">邮箱地址</label><input id="email" name="email" type="email" autoComplete="username" spellCheck={false} required maxLength={254} placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)}/></div>
          {kind === 'register' && <div className="rh-field"><label htmlFor="nickname">昵称<span>选填</span></label><input id="nickname" name="nickname" maxLength={40} autoComplete="nickname" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="在控制台中显示"/></div>}
          {needsCode && <div className="rh-field"><label htmlFor="code">邮箱验证码</label><div className="rh-code"><input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required placeholder="6 位数字" value={code} maxLength={6} enterKeyHint={needsPassword ? 'next' : 'done'} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}/><button type="button" disabled={sending || cooldown > 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={sendCode}>{sending ? '发送中…' : cooldown ? `${cooldown} 秒后重发` : '获取验证码'}</button></div></div>}
          {devCode && <p className="rh-dev-code">开发环境验证码：<strong>{devCode}</strong></p>}
          {needsPassword && <div className="rh-field">
            <div className="rh-label-row"><label htmlFor="password">{kind === 'forgot' ? '新密码' : '密码'}</label>{kind === 'login' && <Link viewTransition to="/forgot">忘记密码？</Link>}</div>
            <div className="rh-password"><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={kind === 'login' ? 'current-password' : 'new-password'} minLength={10} maxLength={72} required enterKeyHint="done" value={password} onChange={e => setPassword(e.target.value)} placeholder={kind === 'login' ? '输入密码' : '至少 10 位'}/><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeSlash size={18}/> : <Eye size={18}/>}</button></div>
            {kind !== 'login' && <small>至少 10 位，最多 72 字节。建议混合字母、数字和符号。</small>}
          </div>}
          {kind === 'login' && <label className="rh-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/><span>30 天内保持登录</span></label>}
          {error && <p className="rh-auth-error" role="alert">{error}</p>}
          <button className="rh-btn rh-btn-primary rh-auth-submit" disabled={busy}>{busy ? '正在处理…' : kind === 'register' ? '创建账号' : kind === 'forgot' ? '重置密码' : '登录'}</button>
        </form>
        <p className="rh-auth-switch">{kind === 'register' ? <>已有账号？<Link viewTransition to="/login">登录</Link></> : kind === 'forgot' ? <>想起密码了？<Link viewTransition to="/login">返回登录</Link></> : <>还没有账号？<Link viewTransition to="/register">创建账号</Link></>}</p>
      </main>
    </div>
    <Link viewTransition className="rh-auth-back" to="/">返回首页</Link>
  </div>;
}

export function RechargePage() {
  const config = useResource('/payments/config'), {summary, refresh} = useWorkspace(), toast = useToast();
  const [params, setParams] = useSearchParams(), [amount, setAmount] = useState('100'), [channel, setChannel] = useState('alipay'), [busy, setBusy] = useState(false), [payment, setPayment] = useState<any>(null), [qr, setQr] = useState(''), [pollError, setPollError] = useState(''), [historyVersion, setHistoryVersion] = useState(0), [historyPage, setHistoryPage] = useState(1), [now, setNow] = useState(Date.now()), [checkingPayment, setCheckingPayment] = useState(false);
  const historyPageSize = 10;
  const history = useResource(`/me/recharges?page=${historyPage}&page_size=${historyPageSize}&v=${historyVersion}`), no = params.get('no');
  const historyPages = Math.max(1, Math.ceil((history.data?.total || 0) / historyPageSize));
  const paymentCodeExpired = payment?.status === 'pending' && paymentCodeExpiry(payment) <= now;
  const paymentNumberRef = useRef(''); paymentNumberRef.current = payment?.recharge_no || '';
  useEffect(() => {if (!history.loading && history.data && historyPage > historyPages) setHistoryPage(historyPages);}, [history.loading, history.data, historyPage, historyPages]);
  useEffect(() => {if (payment?.status !== 'pending' && !history.data?.items?.some((r: any) => r.status === 'pending')) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);}, [payment?.status, history.data]);
  useEffect(() => {const channels = (config.data?.channels || []).filter((c: any) => c.enabled !== false); if (channels.length && !channels.some((c: any) => c.key === channel)) setChannel(channels[0].key);}, [config.data, channel]);
  useEffect(() => {let alive = true; if (no) {api(`/me/recharges/${encodeURIComponent(no)}`).then(d => {if (alive) {setNow(Date.now()); setPayment({...d.recharge, mode: config.data?.mode});}}).catch(e => {if (alive) toast(message(e), true);});} return () => {alive = false;};}, [no, config.data?.mode, toast]);
  useEffect(() => {let live = true; setQr(''); if (payment?.qr_content && !paymentCodeExpired) import('qrcode').then(module => module.default.toDataURL(payment.qr_content, {width: 240, margin: 2, color: {dark: '#142b49', light: '#ffffff'}})).then(value => {if (live) setQr(value);}).catch(() => {if (live) setPollError('二维码生成失败，请刷新后重试。');}); return () => {live = false;};}, [payment?.qr_content, paymentCodeExpired]);
  useEffect(() => {
    if (!payment || payment.status !== 'pending' || paymentCodeExpired) return;
    let live = true;
    const poll = async () => {if (paymentCodeExpiry(payment) <= Date.now()) {setNow(Date.now()); return;} try {const d = await api(`/me/recharges/${encodeURIComponent(payment.recharge_no)}`); if (!live) return; setPollError(''); if (d.recharge.status !== 'pending') {setPayment({...d.recharge, mode: payment.mode}); await refresh(); setHistoryVersion(v => v + 1); if (d.recharge.status === 'paid') toast('充值成功，余额已到账。');}} catch (e) {if (live) setPollError(message(e));}};
    const timer = setInterval(poll, 2500); return () => {live = false; clearInterval(timer);};
  }, [payment?.recharge_no, payment?.status, payment?.mode, paymentCodeExpired, refresh, toast]);
  async function checkPaymentStatus() {
    if (!payment || checkingPayment) return;
    setCheckingPayment(true); setPollError('');
    try {const data = await api(`/me/recharges/${encodeURIComponent(payment.recharge_no)}`); if (paymentNumberRef.current !== payment.recharge_no) return; setNow(Date.now()); setPayment({...data.recharge, mode: payment.mode}); await refresh(); setHistoryVersion(v => v + 1); if (data.recharge.status === 'paid') toast('充值成功，余额已到账。'); else if (data.recharge.status === 'pending') toast('暂未收到支付成功结果，请稍后再查询。');} catch (e) {if (paymentNumberRef.current === payment.recharge_no) setPollError(message(e));} finally {setCheckingPayment(false);}
  }
  function closePayment() {setPayment(null); setParams({}); setPollError('');}
  async function submit(e: FormEvent) {
    e.preventDefault(); const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 1000 || cents > 1000000) {toast('充值金额应为 ¥10 至 ¥10,000。', true); return;}
    setBusy(true);
    try {const data = await api('/me/recharges', 'POST', {amount_cents: cents, channel}); setNow(Date.now()); setPollError(''); setPayment(data); setParams({no: data.recharge_no}); setHistoryPage(1); setHistoryVersion(v => v + 1);} catch (e) {toast(message(e), true);} finally {setBusy(false);}
  }
  const amountCents = Math.round((Number(amount) || 0) * 100), enabledChannel = config.data?.channels?.find((c: any) => c.key === channel && c.enabled !== false);
  const channelName = (key: string) => key === 'alipay' ? '支付宝' : key === 'wechat' ? '微信支付' : key === 'manual' ? '人工充值' : '其他';
  return <div className="recharge-page">
    <Heading title="余额充值" text="充值到账后，可用于购买和续费静态住宅 IP。"/>
    <div className="recharge-grid">
      <section className="panel recharge-form-panel"><form onSubmit={submit}>
        <div className="recharge-section-title"><h2>充值金额</h2><span>人民币 CNY</span></div>
        <div className="amount-grid">{['10', '30', '50', '100', '300', '1000'].map(value => <button type="button" key={value} aria-pressed={amount === value} className={amount === value ? 'selected' : ''} onClick={() => setAmount(value)}><span>¥</span>{value}{amount === value && <Check size={15}/>}</button>)}</div>
        <label className="recharge-custom-amount">自定义金额<div className="input-icon"><span>¥</span><input type="number" required min="10" max="10000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}/></div><small>单次充值 ¥10.00 – ¥10,000.00</small></label>
        <div className="recharge-section-title recharge-channel-title"><h2>支付方式</h2></div>
        {config.loading ? <Loading/> : config.error ? <ErrorState text={config.error} retry={config.reload}/> : <div className="payment-channels">{config.data?.channels?.map((c: any) => <button type="button" aria-pressed={channel === c.key} className={channel === c.key ? 'selected' : ''} key={c.key} disabled={c.enabled === false} title={c.enabled === false ? '该渠道暂未开放' : c.name} onClick={() => setChannel(c.key)}><span className={`channel-logo ${c.key}`}>{c.key === 'alipay' ? '支' : '微'}</span><strong>{c.name}{c.enabled === false && <small>暂未开放</small>}</strong>{channel === c.key && <Check size={16}/>}</button>)}</div>}
        <div className="recharge-submit-row"><div className="recharge-total"><span>应付金额</span><strong>{money(amountCents)}</strong></div><button className="button" disabled={busy || config.loading || !!config.error || !enabledChannel}>{busy ? '正在创建充值单…' : '前往支付'}<ArrowRight size={16}/></button></div>
      </form></section>
      <aside className="panel recharge-account-panel">
        <div className="recharge-balance-label"><Wallet size={18}/><span>当前可用余额</span></div><strong className="recharge-balance-value">{summary ? money(summary.balance_cents) : '—'}</strong>
        <Link to="/app/transactions" className="text-link">查看余额明细 <ArrowRight size={13}/></Link>
        <div className="recharge-guidance"><h3>充值说明</h3><p>确认金额与支付方式后，进入收银台扫码付款。</p><p>支付结果会自动查询，到账后更新账户余额。</p><p>待支付的充值单可从下方记录继续支付。</p></div>
      </aside>
    </div>
    <section className="panel recharge-history"><div className="panel-heading"><div><h2>充值记录</h2><p>查看历史充值与付款状态。</p></div><button className="button secondary small" disabled={history.loading} onClick={history.reload}><ArrowsClockwise size={15}/>刷新</button></div>
      {history.loading ? <Loading/> : history.error ? <ErrorState text={history.error} retry={history.reload}/> : !history.data?.items?.length ? <Empty title="暂无充值记录">选择金额和支付方式，完成第一笔充值。</Empty> : <div className="table-scroll"><table><thead><tr><th>充值单号</th><th>充值金额</th><th>支付方式</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{history.data.items.map((r: any) => <tr key={r.id}><td className="mono">{r.recharge_no}</td><td className="recharge-record-amount">{money(r.amount_cents)}</td><td>{channelName(r.channel)}</td><td><Badge status={r.status}/>{r.status === 'pending' && paymentCodeExpiry(r) <= now && <small className="muted">付款码已失效</small>}</td><td className="nowrap">{date(r.created_at)}</td><td>{r.status === 'pending' ? <button className="text-link" onClick={() => setParams({no: r.recharge_no})}>{paymentCodeExpiry(r) <= now ? '查看状态' : '继续支付'} <ArrowUpRight size={12}/></button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div>}
      {!!history.data?.total && <nav className="pagination recharge-pagination" aria-label="充值记录分页"><span>共 {history.data.total} 笔</span><button className="button secondary small" disabled={history.loading || historyPage <= 1} onClick={() => setHistoryPage(page => Math.max(1, page - 1))}>上一页</button><span>{historyPage} / {historyPages}</span><button className="button secondary small" disabled={history.loading || historyPage >= historyPages} onClick={() => setHistoryPage(page => Math.min(historyPages, page + 1))}>下一页</button></nav>}
    </section>
    {payment && <Modal title="充值收银台" close={closePayment}><div className="cashier recharge-cashier">
      <span className="muted">{channelName(payment.channel)} · {payment.mode === 'mock' || config.data?.mode === 'mock' ? '模拟支付' : '扫码支付'}</span><strong className="cashier-amount">{money(payment.amount_cents)}</strong><Badge status={payment.status}/>
      {payment.status === 'pending' && !paymentCodeExpired && <>{qr ? <img className="qr-image" src={qr} alt="当前充值单付款二维码"/> : <Loading/>}{payment.mode === 'mock' || config.data?.mode === 'mock' ? <><p>本环境仅模拟支付，不会收取真实费用。</p><a className="button" href={payment.pay_url} target="_blank" rel="noopener noreferrer" onClick={event => {if (paymentCodeExpiry(payment) <= Date.now()) {event.preventDefault(); setNow(Date.now());}}}>打开模拟收银台 <ArrowUpRight size={16}/></a></> : <p>请使用{payment.channel === 'wechat' ? '微信' : '支付宝'}扫描二维码完成支付。</p>}<p>付款码有效至 {date(paymentCodeExpiry(payment))}</p><span className="cashier-wait"><span className="spinner"/>正在查询支付结果，到账后自动更新</span></>}
      {paymentCodeExpired && <div className="recharge-code-expired"><WarningCircle size={30}/><h3>付款码已失效</h3><p>付款码已超过 30 分钟有效期，请重新创建充值单。若已付款，可刷新支付状态查看到账结果。</p><div><button className="button" onClick={closePayment}>重新充值</button><button className="button secondary" disabled={checkingPayment} onClick={checkPaymentStatus}>{checkingPayment ? '查询中…' : '刷新支付状态'}</button></div></div>}
      {payment.status === 'paid' && <div className="success-panel"><Check size={38}/><h3>充值成功</h3><p>余额已到账，可用于购买静态住宅 IP。</p><Link className="button" to="/app/static?tab=buy">购买 IP <ArrowRight size={17}/></Link></div>}
      {['failed', 'expired'].includes(payment.status) && <p>本次支付未完成，请重新创建充值单。</p>}{pollError && <div className="error-message" role="alert">{pollError}{paymentCodeExpired ? ' 请稍后刷新支付状态。' : ' 将继续查询。'}</div>}
      <div className="recharge-payment-reference"><span>充值单号</span><code className="cashier-no">{payment.recharge_no}</code></div>
    </div></Modal>}
  </div>;
}

export function NicknameForm() {
  const {user, refresh} = useAuth(), toast = useToast(); const [nickname, setNickname] = useState(user?.nickname || ''), [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {e.preventDefault(); setBusy(true); try {await api('/auth/me', 'PATCH', {nickname}); await refresh(); toast('昵称已更新。');} catch (e) {toast(message(e), true);} finally {setBusy(false);}}
  return <form className="account-nickname-form" onSubmit={save}><label>显示昵称 <span className="muted">（选填）</span><input maxLength={40} autoComplete="nickname" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="用于账户内显示"/></label><button className="button secondary" disabled={busy || nickname === (user?.nickname || '')}>{busy ? '保存中…' : '保存昵称'}</button></form>;
}

export function SettingsPage() {
  const {user, logout} = useAuth(), toast = useToast(); const [oldPassword, setOldPassword] = useState(''), [password, setPassword] = useState(''), [repeat, setRepeat] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (password !== repeat) {toast('两次输入的新密码不一致。', true); return;} if (passwordIssue(password)) {toast(passwordIssue(password), true); return;}
    setBusy(true); try {await api('/auth/change-password', 'POST', {old_password: oldPassword, new_password: password}); toast('密码已修改，请使用新密码重新登录。'); logout();} catch (e) {toast(message(e), true);} finally {setBusy(false);}
  }
  return <div className="settings-page"><Heading title="账号设置" text="管理账号资料与登录密码。"/><div className="settings-grid">
    <section className="panel"><div className="settings-section-heading"><h2>账号资料</h2><p>邮箱是你的注册与登录凭据。</p></div><dl className="account-details"><div><dt>邮箱地址</dt><dd>{user?.email}</dd></div><div><dt>注册时间</dt><dd>{date(user?.created_at)}</dd></div><div><dt>账号角色</dt><dd>{user?.role === 'admin' ? '管理员' : '用户'}</dd></div></dl><NicknameForm/></section>
    <section className="panel" id="password"><div className="settings-section-heading"><h2>登录密码</h2><p>修改成功后，需要使用新密码重新登录。</p></div><form className="settings-password-form" onSubmit={submit}>
      <label>当前密码<input type="password" autoComplete="current-password" required placeholder="请输入当前密码" value={oldPassword} onChange={e => setOldPassword(e.target.value)}/></label>
      <label>新密码<input type="password" autoComplete="new-password" required minLength={10} maxLength={72} placeholder="至少 10 位，建议混合字母与数字" value={password} onChange={e => setPassword(e.target.value)}/><small>至少 10 位，最多 72 字节。</small></label>
      <label>确认新密码<input type="password" autoComplete="new-password" required minLength={10} maxLength={72} placeholder="再次输入新密码" value={repeat} onChange={e => setRepeat(e.target.value)}/></label>
      <div className="settings-form-actions"><button className="button" disabled={busy}>{busy ? '保存中…' : '更新密码'}<ArrowRight size={16}/></button></div>
    </form></section>
  </div></div>;
}
