import React from 'react';
import {Link} from 'react-router-dom';
import {Wallet,GlobeHemisphereWest,Clock,Receipt,ArrowRight,ArrowsClockwise,Plus} from '@phosphor-icons/react';
import {money,date} from './api';
import {useWorkspace,useResource,Heading,Loading,ErrorState,Empty,Badge} from './ui';
import {RentalTable} from './static-pages';

export function Dashboard(){
  const {summary,refresh,error,loading}=useWorkspace();
  const orders=useResource('/me/orders?page_size=5'),transactions=useResource('/me/transactions?page_size=4');
  const actions=<div className="heading-actions"><button className="button secondary icon-only" aria-label="刷新总览" disabled={loading} onClick={()=>{void refresh();void orders.reload();void transactions.reload();}}><ArrowsClockwise size={17}/></button><Link className="button" to="/app/static?tab=buy"><Plus size={16}/>购买 IP</Link></div>;
  return <div className="dashboard-page"><Heading title="账户总览" action={actions}/>
    {!summary ? <section className="panel dashboard-loading">{error?<ErrorState text={error} retry={refresh}/>:<Loading/>}</section> : <>
      {error&&<div className="error-message">更新失败，当前显示上次数据。{error}<button className="text-link" onClick={refresh}>重试</button></div>}{summary.announcement&&<div className="notice announcement">{summary.announcement}</div>}
      <section className="account-metrics" aria-label="账户与IP概况">
        <div className="metric"><div className="metric-label"><span>账户余额</span><Wallet size={17}/></div><strong>{money(summary.balance_cents)}</strong><Link to="/app/recharge">充值余额<ArrowRight size={12}/></Link></div>
        <div className="metric"><div className="metric-label"><span>正常使用的 IP</span><GlobeHemisphereWest size={17}/></div><strong>{summary.static_ip_active}<small>个</small></strong><Link to="/app/static">管理已购 IP<ArrowRight size={12}/></Link></div>
        <div className="metric"><div className="metric-label"><span>7 天内到期</span><Clock size={17}/></div><strong>{summary.static_ip_expiring}<small>个</small></strong><Link to="/app/static">查看已购 IP<ArrowRight size={12}/></Link></div>
        <div className="metric"><div className="metric-label"><span>累计已购 IP</span><Receipt size={17}/></div><strong>{summary.static_ip_total}<small>个</small></strong><Link to="/app/orders">查看购买记录<ArrowRight size={12}/></Link></div>
      </section>
      <section className="panel owned-summary"><div className="panel-heading"><div className="section-title"><h2>我的静态住宅 IP</h2><span className="count-tag">{summary.static_ip_total}</span></div><Link className="text-link" to="/app/static">查看全部<ArrowRight size={13}/></Link></div><RentalTable items={summary.recent_static_ips||[]} reload={refresh} compact/></section>
    </>}
    <div className="dashboard-finance"><section className="panel recent-orders"><div className="panel-heading"><h2>最近订单</h2><Link className="text-link" to="/app/orders">全部订单<ArrowRight size={13}/></Link></div>
      {orders.loading?<Loading/>:orders.error?<ErrorState text={orders.error} retry={orders.reload}/>:!orders.data?.items.length?<Empty title="暂无订单"><p>购买或续费后，可在这里查看订单记录。</p></Empty>:<div className="table-scroll"><table><thead><tr><th>订单 / 产品</th><th>类型</th><th>金额</th><th>状态</th></tr></thead><tbody>{orders.data.items.map((o:any)=><tr key={o.id}><td><code>{o.order_no}</code><small>{o.kind?.startsWith('static_')?o.package_name:'历史服务订单'} · {date(o.created_at)}</small></td><td>{o.kind==='static_purchase'?'购买':o.kind==='static_renewal'?'续费':'历史订单'}</td><td className="numeric">{money(o.amount_cents)}</td><td><Badge status={o.status}/></td></tr>)}</tbody></table></div>}
    </section><section className="panel recent-transactions"><div className="panel-heading"><h2>余额变动</h2><Link className="text-link" to="/app/transactions">账单明细<ArrowRight size={13}/></Link></div>
      {transactions.loading?<Loading/>:transactions.error?<ErrorState text={transactions.error} retry={transactions.reload}/>:!transactions.data?.items.length?<Empty title="暂无余额变动"><p>充值或消费后会生成账单流水。</p></Empty>:<ul className="transaction-list">{transactions.data.items.map((x:any)=><li key={x.id}><span className={`transaction-icon ${x.amount_cents>0?'incoming':'outgoing'}`}><Wallet size={16}/></span><div><strong>{{recharge:'余额充值',purchase:'购买 / 续费',adjust:'余额调整'}[x.type as string]||'余额变动'}</strong><small>{date(x.created_at)}</small></div><span className={`transaction-amount ${x.amount_cents>0?'positive':''}`}>{x.amount_cents>0?'+':'−'}{money(Math.abs(x.amount_cents))}</span></li>)}</ul>}
    </section></div>
  </div>;
}
