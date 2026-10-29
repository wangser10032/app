import axios from 'axios';
import dayjs from 'dayjs';

export const http = axios.create({ baseURL: '/api', timeout: 20000 });
http.interceptors.request.use(config => {
  const token = localStorage.getItem('resihub_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
http.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401 && !error.config?.url?.startsWith('/auth/login')) {
    localStorage.removeItem('resihub_token');
    window.dispatchEvent(new Event('resihub:expired'));
  }
  return Promise.reject(error);
});
export async function api<T = any>(url: string, method = 'GET', data?: unknown, headers?: Record<string,string>): Promise<T> { return (await http.request({ url, method, data, headers })).data; }
export const message = (error: unknown) => axios.isAxiosError(error) ? error.response?.data?.error?.message || (error.code === 'ECONNABORTED' ? '请求超时，请稍后重试。' : '无法连接服务，请检查网络后重试。') : error instanceof Error ? error.message : '操作失败，请重试。';
export const money = (cents = 0) => `¥${(cents / 100).toFixed(2)}`;
export const date = (value?: number) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
export type User = { id: string; email: string; nickname: string; role: string; balance_cents: number; created_at: number };
export type Product = { id:string; name:string; description:string; country:string; region:string; city:string; isp:string; protocol:string; duration_days:number; price_cents:number; available_ips:number };
export type Rental = {id:string; product_name:string; country:string;region:string;city:string;isp:string;ip_host:string;ip_port:number;protocol:string;proxy_host:string;proxy_port:number;username:string;password:string;remark:string;status:string;expires_at:number;created_at:number;renew_price_cents:number;duration_days:number;renewable:boolean};
export type Summary = {balance_cents:number;static_ip_total:number;static_ip_active:number;static_ip_expiring:number;site_name:string;announcement:string;gateway_endpoint:string;recent_static_ips:Rental[]};
