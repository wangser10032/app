import React from 'react';
import {Link} from 'react-router-dom';
import {Wallet,ArrowRight,ArrowsClockwise,Plus,CheckCircle,Megaphone,BookOpen} from '@phosphor-icons/react';
import {money,date} from './api';
import {useAuth,useWorkspace,useResource,Loading,ErrorState,Badge,CopyButton} from './ui';
import {RentalTable} from './static-pages';

export function Dashboard(){
  const {summary,refresh,error,loading}=useWorkspace(),{user}=useAuth();
  const orders=useResource('/me/orders?page_size=5'),transactions=useResource('/me/transactions?page_size=5');
  const reload=()=>{void refresh();void orders.reload();void transactions.reload();};
  if(!summary)return <div className="dashboard-page"><section className="panel dashboard-loading">{error?<ErrorState text={error} retry={refresh}/>:<Loading/>}</section></div>;
  const name=user?.nickname||user?.email?.split('@')[0]||'';
  const steps=[
    {done:summary.balance_cents>0||summary.static_ip_total>0,title:'充值余额',text:'支付宝、微信扫码'},
    {done:summary.static_ip_total>0,title:'购买静态 IP',text:'选择国家与数量'},
    {done:summary.static_ip_active>0,title:'复制凭据接入',text:'三种协议均可接入'},
  ];
  return <div className="dashboard-page">
    {error&&<div className="error-message">更新失败，当前显示上次数据。{error}<button className="text-link" onClick={refresh}>重试</button></div>}
    {summary.announcement&&<div className="dash-announcement"><Megaphone size={18} weight="duotone"/><p>{summary.announcement}</p></div>}
    <section className="dash-hero" aria-label="账户概况">
      <div className="dash-hero-main">
        <span className="dash-hello">你好，{name}</span>
        <small>可用余额</small>
        <strong className="dash-balance">{money(summary.balance_cents)}</strong>
        <div className="dash-hero-actions"><Link className="dash-btn dash-btn-light" to="/app/recharge"><Wallet size={17}/>充值</Link><Link className="dash-btn dash-btn-ghost" to="/app/static?tab=buy"><Plus size={17}/>购买 IP</Link><button type="button" className="dash-btn dash-btn-icon" aria-label="刷新" disabled={loading} onClick={reload}><ArrowsClockwise size={17}/></button></div>
      </div>
      <div className="dash-hero-stats">
        <Link to="/app/static"><span>正在使用</span><strong>{summary.static_ip_active}<em>个</em></strong></Link>
        <Link to="/app/static" className={summary.static_ip_expiring>0?'is-warn':''}><span>7 天内到期</span><strong>{summary.static_ip_expiring}<em>个</em></strong></Link>
        <Link to="/app/orders"><span>累计已购</span><strong>{summary.static_ip_total}<em>个</em></strong></Link>
      </div>
    </section>
    <section className="panel dash-ips">
      <div className="panel-heading"><div className="section-title"><h2>我的静态住宅 IP</h2><span className="count-tag">{summary.static_ip_total}</span></div><Link className="text-link" to="/app/static">查看全部<ArrowRight size={13}/></Link></div>
      {summary.static_ip_total>0?<RentalTable items={summary.recent_static_ips||[]} reload={refresh} compact/>:<div className="dash-start">
        <div className="dash-start-copy"><h3>还没有静态住宅 IP</h3><p>充值后选择国家和数量，即可获得独享 IP 和接入凭据。</p><Link className="button" to="/app/static?tab=buy">选择 IP<ArrowRight size={15}/></Link></div>
        <ol className="dash-steps">{steps.map((s,i)=><li key={s.title} className={s.done?'is-done':''}><b>{s.done?<CheckCircle size={20} weight="fill"/>:i+1}</b><div><strong>{s.title}</strong><span>{s.text}</span></div></li>)}</ol>
      </div>}
      <div className="dash-gateway"><span className="dash-gateway-label">接入地址</span><code>{summary.gateway_endpoint}</code><CopyButton value={summary.gateway_endpoint}/><span className="dash-protocols"><i>HTTP</i><i>HTTPS</i><i>SOCKS5</i></span><Link className="text-link" to="/app/docs"><BookOpen size={15}/>接入说明</Link></div>
    </section>
    <section className="panel dash-activity">
      <div className="dash-col"><div className="panel-heading"><h2>最近订单</h2><Link className="text-link" to="/app/orders">全部订单<ArrowRight size={13}/></Link></div>
        {orders.loading?<Loading/>:orders.error?<ErrorState text={orders.error} retry={orders.reload}/>:!orders.data?.items.length?<p className="dash-empty">购买或续费后，订单会显示在这里。</p>:<div className="table-scroll"><table><thead><tr><th>订单 / 产品</th><th>类型</th><th>金额</th><th>状态</th></tr></thead><tbody>{orders.data.items.map((o:any)=><tr key={o.id}><td><code>{o.order_no}</code><small>{o.kind?.startsWith('static_')?o.package_name:'历史服务订单'} · {date(o.created_at)}</small></td><td>{o.kind==='static_purchase'?'购买':o.kind==='static_renewal'?'续费':'历史订单'}</td><td className="numeric">{money(o.amount_cents)}</td><td><Badge status={o.status}/></td></tr>)}</tbody></table></div>}
      </div>
      <div className="dash-col"><div className="panel-heading"><h2>余额变动</h2><Link className="text-link" to="/app/transactions">账单明细<ArrowRight size={13}/></Link></div>
        {transactions.loading?<Loading/>:transactions.error?<ErrorState text={transactions.error} retry={transactions.reload}/>:!transactions.data?.items.length?<p className="dash-empty">充值或消费后，账单流水会显示在这里。</p>:<ul className="transaction-list">{transactions.data.items.map((x:any)=><li key={x.id}><span className={`transaction-icon ${x.amount_cents>0?'incoming':'outgoing'}`}><Wallet size={16}/></span><div><strong>{{recharge:'余额充值',purchase:'购买 / 续费',adjust:'余额调整'}[x.type as string]||'余额变动'}</strong><small>{date(x.created_at)}</small></div><span className={`transaction-amount ${x.amount_cents>0?'positive':''}`}>{x.amount_cents>0?'+':'−'}{money(Math.abs(x.amount_cents))}</span></li>)}</ul>}
      </div>
    </section>
  </div>;
}
