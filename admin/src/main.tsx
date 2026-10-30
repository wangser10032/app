import React, { FormEvent, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Banknote, Box, Check, ChevronDown, CircleHelp, Globe2, LayoutDashboard, LoaderCircle, LogOut, Menu, Settings2, ShieldCheck, Users, Wallet, X } from 'lucide-react';
import { api, Row, send, TOKEN_KEY } from './api';
import { Auth, ErrorBox, Notify, Spinner } from './ui';
import { IPsPage, RechargesPage, UsersPage } from './operations';
import { AccountPage, Dashboard, LeasesPage, OrdersPage, ProductsPage, SettingsPage } from './static-pages';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/700.css';
import './styles.css';
import './commercial.css';

const navigation = [
  { path: '/', title: '概览', icon: LayoutDashboard, end: true },
  { path: '/users', title: '用户', icon: Users },
  { path: '/recharges', title: '充值对账', icon: Wallet },
  { path: '/orders', title: '订单', icon: Banknote },
  { path: '/static-products', title: '静态产品', icon: Box },
  { path: '/ips', title: 'IP 资源', icon: Globe2 },
  { path: '/static-ips', title: 'IP 租赁', icon: ShieldCheck },
  { path: '/settings', title: '站点设置', icon: Settings2 },
];
function Layout() {
  const { user, logout } = useContext(Auth);
  const [open, setOpen] = useState(false), location = useLocation(), menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { setOpen(false); menu.current?.removeAttribute('open'); }, [location.pathname]);
  if (!user) return <Navigate to="/login" replace />;
  return <div className="shell"><button className={`sidebar-overlay ${open ? 'show' : ''}`} aria-label="关闭导航" onClick={() => setOpen(false)} /><aside className={`sidebar ${open ? 'open' : ''}`}><Link to="/" className="brand"><span className="brand-symbol" aria-hidden="true">R</span><span>ResiHub</span><small>管理</small></Link><div className="nav-caption">运营管理</div><nav aria-label="管理导航">{navigation.map(item => <NavLink to={item.path} key={item.path} end={item.end} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}><item.icon size={17} /><span>{item.title}</span></NavLink>)}</nav><a href="/" target="_blank" rel="noreferrer" className="front-link">用户前台 <ArrowRight size={14} /></a></aside><div className="workspace"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setOpen(true)} aria-label="打开导航"><Menu size={20} /></button><span className="breadcrumb">管理后台<span>/</span><strong>{navigation.find(n => n.path === location.pathname)?.title || '账号设置'}</strong></span></div><details className="account-menu" ref={menu}><summary><span className="avatar">{(user.nickname || user.email || 'A')[0].toUpperCase()}</span><span className="user-email">{user.email}</span><ChevronDown size={14} /></summary><div className="account-dropdown"><span>{user.email}</span><Link to="/account"><Settings2 size={15} />账号设置 / 修改密码</Link><button onClick={logout}><LogOut size={15} />退出登录</button></div></details></header><main className="content"><Outlet /></main><footer className="footer"><span>ResiHub 管理后台</span><span>北京时间 UTC+8</span></footer></div></div>;
}
function Login() {
  const { user, login } = useContext(Auth), navigate = useNavigate();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; image: string; expires_at: number } | null>(null), [answer, setAnswer] = useState(''), [loadingCaptcha, setLoadingCaptcha] = useState(false), [captchaError, setCaptchaError] = useState('');
  const challengeRequest = useRef(0);
  const refreshCaptcha = useCallback(async () => {
    const request = ++challengeRequest.current;
    setLoadingCaptcha(true); setChallenge(null); setAnswer(''); setCaptchaError('');
    try { const next = await api('/auth/captcha?purpose=login'); if (request === challengeRequest.current) setChallenge(next); }
    catch (e) { if (request === challengeRequest.current) setCaptchaError((e as Error).message); }
    finally { if (request === challengeRequest.current) setLoadingCaptcha(false); }
  }, []);
  useEffect(() => { refreshCaptcha(); return () => { challengeRequest.current++; }; }, [refreshCaptcha]);
  if (user) return <Navigate to="/" replace />;
  async function submit(e: FormEvent) { e.preventDefault(); if (!challenge) return; setError(''); setBusy(true); try { const d = await send('/auth/login', 'POST', { email, password, captcha: { id: challenge.id, answer } }); if (d.user.role !== 'admin') throw new Error('此账号没有管理权限。'); localStorage.setItem(TOKEN_KEY, d.token); login(d.user); navigate('/', { replace: true }); } catch (e) { setError((e as Error).message); await refreshCaptcha(); } finally { setBusy(false); } }
  return <div className="login-page"><form className="login-form" onSubmit={submit}><Link to="/" className="brand"><span className="brand-symbol" aria-hidden="true">R</span><span>ResiHub</span></Link><h1>管理后台登录</h1>{error && <ErrorBox error={error} />}<label className="field"><span>管理员邮箱</span><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" /></label><label className="field"><span>密码</span><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><div className="field admin-captcha"><label htmlFor="admin-captcha-answer">人机验证</label><div className="admin-captcha-row"><input id="admin-captcha-answer" autoComplete="off" spellCheck={false} required pattern="[A-Za-z0-9]{5}" maxLength={5} placeholder="图中 5 位字符" value={answer} onChange={e => setAnswer(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())}/><button type="button" disabled={busy || loadingCaptcha} onClick={refreshCaptcha} aria-label="刷新图形验证码">{challenge ? <img src={challenge.image} alt="人机验证图片，输入图中五位字符" width="196" height="60"/> : <span>{loadingCaptcha ? '加载中…' : '点击重试'}</span>}</button></div><small>{captchaError || '不区分大小写，点击图片可更换。'}</small></div><button className="button full" disabled={busy || loadingCaptcha || !challenge}>{busy && <LoaderCircle size={17} className="spin" />}登录</button><a className="back-link" href="/">返回用户前台</a></form></div>;
}
function App() {
  const [user, setUser] = useState<Row | null>(null), [checking, setChecking] = useState(!!localStorage.getItem(TOKEN_KEY));
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null), timer = useRef<ReturnType<typeof setTimeout>>();
  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => { clearTimeout(timer.current); setToast({ message, type }); timer.current = setTimeout(() => setToast(null), type === 'error' ? 10000 : 5000); }, []);
  const logout = useCallback(() => { localStorage.removeItem(TOKEN_KEY); setUser(null); }, []);
  useEffect(() => { if (!localStorage.getItem(TOKEN_KEY)) return; api('/auth/me').then(d => { if (d.user.role === 'admin') setUser(d.user); else logout(); }).catch(() => logout()).finally(() => setChecking(false)); }, [logout]);
  useEffect(() => { const denied = () => { logout(); notify('登录已失效，请重新登录。', 'error'); }; window.addEventListener('resihub:unauthorized', denied); return () => window.removeEventListener('resihub:unauthorized', denied); }, [logout, notify]);
  if (checking) return <div className="boot"><Spinner /></div>;
  return <Auth.Provider value={{ user, login: setUser, logout }}><Notify.Provider value={notify}><BrowserRouter basename="/admin"><Routes><Route path="/login" element={<Login />} /><Route element={<Layout />}><Route index element={<Dashboard />} /><Route path="users" element={<UsersPage />} /><Route path="recharges" element={<RechargesPage />} /><Route path="orders" element={<OrdersPage />} /><Route path="static-products" element={<ProductsPage />} /><Route path="ips" element={<IPsPage />} /><Route path="static-ips" element={<LeasesPage />} /><Route path="settings" element={<SettingsPage />} /><Route path="account" element={<AccountPage />} /><Route path="*" element={<div className="card not-found"><h1>页面不存在</h1><Link className="button" to="/">返回概览</Link></div>} /></Route></Routes></BrowserRouter>{toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type === 'success' ? <Check size={18} /> : <CircleHelp size={18} />}<span>{toast.message}</span><button className="icon-button" onClick={() => setToast(null)} aria-label="关闭提示"><X size={16} /></button></div>}</Notify.Provider></Auth.Provider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
