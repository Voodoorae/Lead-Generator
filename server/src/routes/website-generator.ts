import {Router,type IRouter} from 'express';
import {createHash,timingSafeEqual} from 'node:crypto';
import pg from 'pg';

const router:IRouter=Router();
const db=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL}):null;
const valid=(value:unknown)=>Boolean(process.env.WEBSITE_DASHBOARD_TOKEN)&&typeof value==='string'&&timingSafeEqual(createHash('sha256').update(value).digest(),createHash('sha256').update(process.env.WEBSITE_DASHBOARD_TOKEN!).digest());
router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");next();});
router.post('/login',(req,res)=>{
  if(!valid(req.body?.token))return res.status(403).send('Access denied');
  res.cookie('website_access',req.body.token,{httpOnly:true,secure:true,sameSite:'strict',path:'/website-generator',maxAge:7*86400000});
  res.redirect(303,'/website-generator');
});
router.use((req,res,next)=>{
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('website_access='))?.slice('website_access='.length);
  let decoded='';try{decoded=decodeURIComponent(cookie||'');}catch{}
  if(valid(req.headers.authorization?.replace(/^Bearer /,''))||valid(decoded))return next();
  if(req.path==='/'&&req.method==='GET')return res.send('<!doctype html><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width"><title>Proxaim website generator</title><style>body{font:18px Arial;max-width:650px;margin:60px auto;padding:24px}input,button{font:inherit;padding:12px;margin:12px 0}</style><h1>Proxaim website generator</h1><p>The cloud worker runs independently of this dashboard.</p><form method="post" action="/website-generator/login"><label>Access key <input type="password" name="token" required autocomplete="current-password"></label><button>Open generator</button></form>');
  return res.status(401).send('Authentication required');
});
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
router.get('/',async(_req,res)=>{
  if(!db)return res.status(503).send('Database not configured');
  try{
    const runs=(await db.query('SELECT run_date,status,summary FROM website_runs ORDER BY run_date DESC LIMIT 14')).rows;
    const rows=(await db.query("SELECT p.id,p.sector,p.status,p.hold_reason,p.qualification->>'company' AS company,v.html IS NOT NULL AS preview_available FROM website_prospects p LEFT JOIN website_previews v ON v.prospect_id=p.id WHERE p.status<>'retired' ORDER BY p.updated_at DESC LIMIT 100")).rows;
    return res.send(`<!doctype html><meta name="viewport" content="width=device-width"><title>Proxaim website generator</title><style>body{font:16px/1.6 Arial;margin:32px;color:#173b40}table{border-collapse:collapse;width:100%;margin:24px 0}td,th{padding:14px;text-align:left;border-bottom:1px solid #ddd}a{color:#006b68}.run{background:#f1f6f5;padding:18px;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Proxaim website generator</h1><p>Weekdays at 9am UK time. Up to 20 introductions within the shared 100-email limit. No automatic follow-ups.</p><p>Open prospects remain active. Concluded previews retire; unanswered introductions close after 30 days following a final reply check.</p><h2>Active prospects</h2><table><tr><th>Business</th><th>Sector</th><th>Status</th><th>Next check</th><th>Build</th></tr>${rows.map(r=>`<tr><td>${esc(r.company)}</td><td>${esc(r.sector)}</td><td>${esc(r.status)}</td><td>${esc(r.hold_reason)}</td><td>${r.preview_available?`<a href="/website-generator/preview/${encodeURIComponent(r.id)}">Open private preview</a>`:'Pending qualification'}</td></tr>`).join('')}</table><h2>Recent runs</h2>${runs.map(r=>`<section class="run"><strong>${esc(new Date(r.run_date).toISOString().slice(0,10))}: ${esc(r.status)}</strong><pre>${esc(JSON.stringify(r.summary,null,2))}</pre></section>`).join('')}`);
  }catch{return res.status(503).send('The cloud worker has not initialised its records yet.');}
});
router.get('/preview/:id',async(req,res)=>{
  if(!db||!/^website-[a-z0-9-]+$/.test(req.params.id))return res.status(404).send('Preview not found');
  try{
    const row=(await db.query('SELECT html,retired_at FROM website_previews WHERE prospect_id=$1',[req.params.id])).rows[0];
    if(!row)return res.status(404).send('Preview not found');
    if(row.retired_at||!row.html)return res.status(410).send('This preview has retired');
    res.setHeader('Content-Type','text/html; charset=utf-8');return res.send(row.html);
  }catch{return res.status(503).send('Preview temporarily unavailable');}
});
export default router;
