import React, {useEffect, useRef, useState, type FormEvent} from 'react';
import {Link, Navigate, useNavigate} from 'react-router-dom';
import {ArrowLeft, ArrowRight, ArrowsClockwise, CheckCircle, Eye, EyeSlash, LockKey, PlugsConnected, ShieldCheck} from '@phosphor-icons/react';
import {api, message} from './api';
import {Brand, passwordIssue, useAuth, useToast} from './ui';
import {Globe} from './globe';
import '@fontsource/noto-sans-sc/900.css';
import './auth.css';

type Kind = 'login' | 'register' | 'forgot';
type Challenge = {id: string; image: string; expires_at: number};

export function AuthPage({kind}: {kind: Kind}) {
  const auth = useAuth(), navigate = useNavigate(), toast = useToast();
  const [tab, setTab] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [remember, setRemember] = useState(true), [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState('');
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({}), [clock, setClock] = useState(Date.now());
  const [sentEmail, setSentEmail] = useState(''), [devCode, setDevCode] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null), [answer, setAnswer] = useState('');
  const [challengeLoading, setChallengeLoading] = useState(false), [challengeError, setChallengeError] = useState('');
  const [challengeVersion, setChallengeVersion] = useState(0);
  const emailInput = useRef<HTMLInputElement>(null), captchaInput = useRef<HTMLInputElement>(null);
  const purpose = kind === 'forgot' ? 'reset' : kind;
  const needsCode = kind !== 'login' || tab === 'code';
  const needsPassword = kind !== 'login' || tab === 'password';
  const emailKey = email.trim().toLowerCase();
  const cooldown = Math.max(0, Math.ceil(((cooldowns[emailKey] || 0) - clock) / 1000));
  const identity = useRef({key: '', version: 0});
  const identityKey = `${kind}:${tab}:${emailKey}`;
  if (identity.current.key !== identityKey) identity.current = {key: identityKey, version: identity.current.version + 1};
  const mounted = useRef(true);
  const emailSent = needsCode && sentEmail === emailKey && !!sentEmail;
  const showChallenge = !emailSent || cooldown === 0;

  useEffect(() => {
    setError(''); setPassword(''); setCode(''); setDevCode(''); setSentEmail(''); setShowPassword(false);
  }, [kind, tab]);
  useEffect(() => {setBusy(false); setSending(false);}, [kind, tab, emailKey]);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {
    let live = true;
    setAnswer(''); setChallenge(null); setChallengeError(''); setChallengeLoading(true);
    api<Challenge>(`/auth/captcha?purpose=${purpose}`).then(data => {if (live) setChallenge(data);})
      .catch(e => {if (live) setChallengeError(message(e));}).finally(() => {if (live) setChallengeLoading(false);});
    return () => {live = false;};
  }, [purpose, tab, challengeVersion]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setClock(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (!challenge) return;
    const timer = setTimeout(() => {
      setChallenge(null); setAnswer(''); setChallengeError('图片已过期，请换一张后重试。');
    }, Math.max(0, challenge.expires_at - Date.now()));
    return () => clearTimeout(timer);
  }, [challenge]);

  function refreshChallenge() {setChallengeVersion(value => value + 1);}
  function captchaValue() {
    if (!challenge || !answer.trim()) {
      setError('请先填写图片中的字符。'); captchaInput.current?.focus(); return null;
    }
    if (challenge.expires_at <= Date.now()) {
      setError('图片已过期，请填写新图片中的字符。'); refreshChallenge(); return null;
    }
    return {id: challenge.id, answer: answer.trim()};
  }
  async function sendCode() {
    if (!emailInput.current?.reportValidity()) return;
    const captcha = captchaValue(); if (!captcha) return;
    const requestIdentity = identity.current;
    setSending(true); setError('');
    try {
      const data = await api('/auth/send-code', 'POST', {email: emailKey, purpose, captcha});
      if (!mounted.current) return;
      const now = Date.now(); setClock(now); setCooldowns(value => ({...value, [emailKey]: now + 60000}));
      if (identity.current !== requestIdentity) return;
      setSentEmail(emailKey); setDevCode(data.dev_code || '');
      toast(data.dev_code ? '开发验证码已生成' : '验证码已发送，请检查邮箱。');
    } catch (e) {if (mounted.current && identity.current === requestIdentity) setError(message(e));}
    finally {if (mounted.current && identity.current === requestIdentity) {setSending(false); refreshChallenge();}}
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (needsPassword && kind !== 'login' && passwordIssue(password)) {setError(passwordIssue(password)); return;}
    const captcha = !needsCode ? captchaValue() : undefined;
    if (!needsCode && !captcha) return;
    const requestIdentity = identity.current;
    setBusy(true); setError('');
    try {
      if (kind === 'forgot') {
        await api('/auth/reset-password', 'POST', {email: emailKey, code, password});
        if (!mounted.current || identity.current !== requestIdentity) return;
        auth.logout(); toast('密码已重置，请重新登录。'); navigate('/login');
      } else {
        const data = await api(kind === 'register' ? '/auth/register' : tab === 'code' ? '/auth/login-code' : '/auth/login', 'POST', {email: emailKey, password, code, remember, captcha});
        if (!mounted.current || identity.current !== requestIdentity) return;
        auth.accept(data); navigate('/app');
      }
    } catch (e) {if (mounted.current && identity.current === requestIdentity) {setError(message(e)); if (!needsCode) refreshChallenge();}}
    finally {if (mounted.current && identity.current === requestIdentity) setBusy(false);}
  }
  if (auth.ready && auth.user && kind !== 'forgot') return <Navigate to="/app" replace/>;
  const title = kind === 'register' ? '创建你的 ResiHub 账号' : kind === 'forgot' ? '找回你的账号' : '欢迎回来';
  const lead = kind === 'register' ? '用邮箱注册，开始管理你的静态住宅 IP。' : kind === 'forgot' ? '验证邮箱后，为账号设置一个新密码。' : '登录控制台，查看 IP、订单与账户余额。';

  return <div className="access-page">
    <aside className="access-aside">
      <div className="access-glow" aria-hidden="true"><i/><i/><i/></div>
      <Brand/>
      <div className="access-story">
        <h2>租期内，<br/>出口始终是<br/><span className="access-em">同一个 IP</span></h2>
        <ul className="access-points">
          <li><ShieldCheck size={22} weight="duotone"/><div><strong>独享静态住宅 IP</strong><span>同一时间只属于你，不与他人共用</span></div></li>
          <li><PlugsConnected size={22} weight="duotone"/><div><strong>HTTP / HTTPS / SOCKS5</strong><span>同一地址、同一组凭据即可接入</span></div></li>
          <li><ArrowsClockwise size={22} weight="duotone"/><div><strong>续费保留原 IP</strong><span>支付宝、微信充值，余额实时到账</span></div></li>
        </ul>
      </div>
      <div className="access-globe" aria-hidden="true"><Globe theme="light"/></div>
    </aside>
    <main className="access-main">
      <header className="access-top"><Link to="/" className="access-back"><ArrowLeft size={16}/>返回首页</Link><span>{kind === 'register' ? '已有账号？' : '还没有账号？'}<Link to={kind === 'register' ? '/login' : '/register'}>{kind === 'register' ? '登录' : '注册账号'}<ArrowRight size={14}/></Link></span></header>
      <div className="access-content">
        <div className="access-mobile-brand"><Brand/></div>
        <div className="access-heading"><h1>{title}</h1><p>{lead}</p></div>
        {kind === 'login' && <div className="access-tabs" aria-label="登录方式">
          <button type="button" aria-pressed={tab === 'password'} onClick={() => setTab('password')}>密码登录</button>
          <button type="button" aria-pressed={tab === 'code'} onClick={() => setTab('code')}>邮箱验证码登录</button>
        </div>}
        <form className="access-form" onSubmit={submit}>
          <div className="access-field"><label htmlFor="email">邮箱地址</label><input ref={emailInput} id="email" name="email" type="email" autoComplete="username" required maxLength={254} placeholder="输入你的邮箱" spellCheck={false} value={email} onChange={e => {setEmail(e.target.value); setCode(''); setDevCode('');}}/></div>
          {needsPassword && <div className="access-field">
            <div className="access-label"><label htmlFor="password">{kind === 'forgot' ? '新密码' : '密码'}</label>{kind === 'login' && <Link to="/forgot">忘记密码？</Link>}</div>
            <div className="access-password"><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={kind === 'login' ? 'current-password' : 'new-password'} minLength={kind === 'login' ? 1 : 10} maxLength={72} required value={password} onChange={e => setPassword(e.target.value)} placeholder={kind === 'login' ? '输入你的密码' : '至少 10 位，建议包含字母和数字'} aria-describedby={kind !== 'login' ? 'password-hint' : undefined}/><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeSlash size={19}/> : <Eye size={19}/>}</button></div>
            {kind !== 'login' && <small id="password-hint">至少 10 位，建议混合字母、数字和符号。</small>}
          </div>}
          {showChallenge && <div className="access-field access-human">
            <div className="access-label"><label htmlFor="captcha-answer">人机验证</label><button className="access-refresh" type="button" disabled={challengeLoading || sending || busy} onClick={refreshChallenge}><ArrowsClockwise size={14} className={challengeLoading ? 'access-spinning' : ''}/>换一张</button></div>
            <div className="access-captcha-row"><input ref={captchaInput} id="captcha-answer" name="captcha" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="输入右侧字符" maxLength={8} value={answer} onChange={e => setAnswer(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())} required={!needsCode} aria-describedby="captcha-hint"/><button type="button" className="access-captcha-image" aria-label="更换验证码图片" disabled={challengeLoading || sending || busy} onClick={refreshChallenge}>{challengeLoading ? <span>加载中…</span> : challenge ? <img src={challenge.image} alt="人机验证图片" width="160" height="56"/> : <span>点击重新加载</span>}</button></div>
            <small id="captcha-hint" className={challengeError ? 'access-inline-error' : ''}>{challengeError || (needsCode ? '不区分大小写，发送邮箱验证码前需完成验证。' : '输入图片中的 5 位字符，不区分大小写。')}</small>
          </div>}
          {emailSent && cooldown > 0 && <div className="access-verified" role="status"><CheckCircle size={18} weight="fill"/><span>验证通过，邮箱验证码已发送</span></div>}
          {needsCode && <div className="access-field"><label htmlFor="code">邮箱验证码</label><div className="access-code"><input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required placeholder="输入 6 位验证码" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}/><button type="button" onClick={sendCode} disabled={sending || cooldown > 0 || !emailKey || !challenge || !answer.trim()}>{sending ? '发送中…' : cooldown ? `${cooldown} 秒后重发` : emailSent ? '重新发送' : '获取验证码'}</button></div></div>}
          {devCode && <p className="access-dev-code">开发环境验证码：<strong>{devCode}</strong></p>}
          {kind === 'login' && <label className="access-remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/>30 天内保持登录</label>}
          {error && <p className="access-error" role="alert">{error}</p>}
          <button type="submit" className="access-submit" disabled={busy || sending}>{busy ? '正在处理…' : kind === 'register' ? '创建账号' : kind === 'forgot' ? '重置密码' : '登录控制台'}<ArrowRight size={18}/></button>
        </form>
        {kind === 'forgot' && <Link className="access-return-login" to="/login">返回登录</Link>}
        <p className="access-security"><LockKey size={14}/>邮箱仅用于账号验证与服务通知</p>
      </div>
      <footer className="access-footer"><span>ResiHub 静态住宅代理</span><span>账户中心</span></footer>
    </main>
  </div>;
}
