const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {randomUUID}=require('node:crypto');const Database=require('better-sqlite3');
test('static migration preserves historical balances, paid recharges, bills and legacy orders across repeated boots',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'resihub-static-migration-')),file=path.join(dir,'old.db');
 Object.assign(process.env,{NODE_ENV:'test',DB_PATH:file,MAIL_MODE:'mock',PAYMENT_MODE:'mock'});
 const original=new Database(file),schema=fs.readFileSync(path.join(__dirname,'../src/db/schema.sql'),'utf8').split('CREATE TABLE IF NOT EXISTS static_products')[0];original.exec(schema);
 const user=randomUUID(),pkg=randomUUID(),order=randomUUID(),recharge=randomUUID();
 original.prepare("INSERT INTO users(id,email,password_hash,balance_cents,created_at) VALUES(?,'existing@example.test','preserve-password-hash',9010,1)").run(user);
 original.prepare("INSERT INTO packages(id,name,traffic_mb,price_cents,created_at) VALUES(?,'历史套餐',1024,990,1)").run(pkg);
 original.prepare("INSERT INTO orders(id,order_no,user_id,package_id,package_name,traffic_mb,amount_cents,created_at) VALUES(?,'OLD-ORDER',?,?,'历史套餐',1024,990,2)").run(order,user,pkg);
 original.prepare("INSERT INTO recharges(id,recharge_no,user_id,amount_cents,channel,status,paid_at,created_at) VALUES(?,'OLD-RECHARGE',?,10000,'alipay','paid',1,1)").run(recharge,user);
 original.prepare("INSERT INTO ledger(id,user_id,type,amount_cents,balance_after_cents,ref_type,ref_id,created_at) VALUES(?,?,'recharge',10000,10000,'recharge',?,1)").run(randomUUID(),user,recharge);
 original.prepare("INSERT INTO ledger(id,user_id,type,amount_cents,balance_after_cents,ref_type,ref_id,created_at) VALUES(?,?,'purchase',-990,9010,'order',?,2)").run(randomUUID(),user,order);
 original.close();
 for(let i=0;i<2;i++){
  delete require.cache[require.resolve('../src/db')];const db=require('../src/db');
  assert.equal(db.prepare('SELECT balance_cents FROM users WHERE id=?').get(user).balance_cents,9010);
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get(user).password_hash,'preserve-password-hash');
  assert.equal(db.prepare('SELECT kind FROM orders WHERE id=?').get(order).kind,'legacy');assert.equal(db.prepare('SELECT package_name FROM orders WHERE id=?').get(order).package_name,'历史套餐');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger').get().n,2);assert.equal(db.prepare('SELECT status FROM recharges WHERE id=?').get(recharge).status,'paid');
  assert.equal(db.prepare('SELECT status FROM packages WHERE id=?').get(pkg).status,'disabled');assert.equal(db.prepare('SELECT COUNT(*) n FROM static_rentals').get().n,0);
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
 }
 fs.rmSync(dir,{recursive:true,force:true});
});
