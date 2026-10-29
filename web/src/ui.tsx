import React, { createContext, useContext, useEffect, useState, useCallback, useRef, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, GlobeHemisphereWest, ShieldCheck, Lightning, Wallet, SquaresFour, Package as PackageIcon, Receipt, Key, BookOpen, Gear, SignOut, Copy, Check, X, List, Plus, ArrowsClockwise, CreditCard, ChartBar, Clock, CaretRight, EnvelopeSimple, LockKey, WarningCircle } from '@phosphor-icons/react';

import { api, message, type User, type Summary } from './api';


type Auth = { user: User | null; ready: boolean; accept: (data: {token: string; user: User}) => void; logout: () => void; refresh: () => Promise<void> };
const AuthContext = createContext<Auth>(null!);
export const useAuth = () => useContext(AuthContext);
const ToastContext = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function passwordIssue(value: string) { return value.length < 10 ? '密码至少需要 10 位。' : new TextEncoder().encode(value).length > 72 ? '密码不能超过 72 字节，建议使用英文字母、数字与符号。' : ''; }
export function Providers({ children }: {children: ReactNode}) {
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(false), [toast, setToast] = useState<{text: string; error: boolean} | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const logout = useCallback(() => { localStorage.removeItem('resihub_token'); setUser(null); }, []);
  const refresh = useCallback(async () => { if (localStorage.getItem('resihub_token')) { const data = await api('/auth/me'); setUser(data.user); } }, []);
  useEffect(() => { refresh().catch(() => logout()).finally(() => setReady(true)); window.addEventListener('resihub:expired', logout); return () => window.removeEventListener('resihub:expired', logout); }, [refresh, logout]);
  const notify = useCallback((text: string, error = false) => { clearTimeout(toastTimer.current); setToast({text, error}); toastTimer.current = setTimeout(() => setToast(null), 4500); }, []);
  return <AuthContext.Provider value={{user, ready, refresh, logout, accept: data => {localStorage.setItem('resihub_token', data.token); setUser(data.user);}}}><ToastContext.Provider value={notify}>{children}{toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status">{toast.error ? <WarningCircle size={20}/> : <Check size={20}/>} {toast.text}<button aria-label="关闭提示" onClick={() => setToast(null)}><X/></button></div>}</ToastContext.Provider></AuthContext.Provider>;
}
export function useResource<T = any>(path: string) {
  const [data, setData] = useState<T | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { setData(await api<T>(path)); } catch (e) { setError(message(e)); } finally { setLoading(false); } }, [path]);
  useEffect(() => { let live = true; setLoading(true); setError(''); api<T>(path).then(d => {if(live) setData(d);}).catch(e => {if(live) setError(message(e));}).finally(() => {if(live) setLoading(false);}); return () => {live = false;}; }, [path]);
  return {data, loading, error, reload: load};
}
export function Brand() { return <Link className="brand" to="/" aria-label="ResiHub 静态住宅代理"><span className="brand-symbol" aria-hidden="true">R<span/></span><span className="brand-wordmark"><strong>ResiHub</strong><small>静态住宅代理</small></span></Link>; }
export function Loading() { return <div className="state"><span className="spinner"/>正在加载…</div>; }
export function ErrorState({text, retry}: {text: string; retry?: () => void}) { return <div className="state"><WarningCircle size={32}/><p>{text}</p>{retry && <button className="button secondary" onClick={retry}>重新加载</button>}</div>; }
export function Empty({title = '暂无记录', children}: {title?: string; children?: ReactNode}) { return <div className="state state-empty"><strong>{title}</strong>{children && <div className="empty-content">{children}</div>}</div>; }
export function CopyButton({value, label = '复制'}: {value: string; label?: string}) { const toast = useToast(); const [done, setDone] = useState(false); return <button type="button" className="button secondary small" onClick={async () => { try {await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1800);} catch {toast('无法访问剪贴板，请手动选中复制。', true);} }}>{done ? <Check size={15}/> : <Copy size={15}/>} {done ? '已复制' : label}</button>; }
export function Modal({title, children, close}: {title: string; children: ReactNode; close: () => void}) {
  const box = useRef<HTMLDivElement>(null), closeRef = useRef(close); closeRef.current = close;
  useEffect(() => { const previous = document.activeElement as HTMLElement; const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; box.current?.focus(); const key = (event: KeyboardEvent) => { if(event.key === 'Escape') closeRef.current(); if(event.key === 'Tab') {const items = Array.from(box.current?.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [tabindex="0"]') || []).filter(el => !el.hasAttribute('disabled')); if(!items.length) {event.preventDefault();return;} const first = items[0], last = items[items.length - 1]; if(event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {event.preventDefault(); last.focus();} else if(!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}}}; document.addEventListener('keydown', key); return () => {document.body.style.overflow = old; document.removeEventListener('keydown', key); previous?.focus();}; }, []);
  return <div className="modal-backdrop" onMouseDown={e => {if(e.target === e.currentTarget) close();}}><div role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box} className="modal"><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={close}><X size={21}/></button></div>{children}</div></div>;
}
const statusText: Record<string,string> = { active:'正常', unavailable:'暂不可用', disabled:'已停用', paid:'已支付', pending:'待支付', failed:'支付失败', expired:'已过期', exhausted:'已用完', cancelled:'已取消', refunded:'已退款' };
export function Badge({status}: {status: string}) { return <span className={`badge badge-${status}`}>{statusText[status] || status}</span>; }
export function Heading({title,text,action}: {eyebrow?:string;title:string;text?:string;action?:ReactNode}) { return <div className="page-heading"><div><h1>{title}</h1>{text&&<p>{text}</p>}</div>{action}</div>; }


export const WorkspaceContext=createContext<{summary:Summary|null;refresh:()=>Promise<void>;loading?:boolean;error?:string}>(null!);
export const useWorkspace=()=>useContext(WorkspaceContext);
