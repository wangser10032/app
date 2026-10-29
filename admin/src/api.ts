export type Row = Record<string, any>;
export const TOKEN_KEY = 'resihub_admin_token';
export async function api(path: string, init: RequestInit = {}): Promise<any> {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`/api${path}`, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') { localStorage.removeItem(TOKEN_KEY); window.dispatchEvent(new Event('resihub:unauthorized')); }
    throw new Error(body?.error?.message || `请求失败（${response.status}）`);
  }
  return body;
}
export const send = (path: string, method: string, body?: unknown) => api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const money = (cents: number = 0) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2 }).format(cents / 100);
export const time = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) : '—';
export const traffic = (mb: number = 0) => mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
export function cents(value: string) { if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error('金额最多保留两位小数'); const result = Math.round(Number(value) * 100); if (!Number.isSafeInteger(result)) throw new Error('金额超出有效范围'); return result; }
export function validatePassword(value: string) { if (value.length < 10) throw new Error('新密码至少 10 个字符'); if (new TextEncoder().encode(value).length > 72) throw new Error('新密码最多 72 字节，中文等字符会占多个字节'); }
