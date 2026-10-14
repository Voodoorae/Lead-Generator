import { campaignLimit } from './outreach-policy.mjs';

export function nextRampTarget({previous=10,completed=false,statuses=[],configured=50}) {
  if(!Number.isFinite(previous)||previous<1||previous>50)throw Error('Previous ramp target invalid');
  campaignLimit({configured,rampTarget:1});
  const healthy=completed&&statuses.length>0&&statuses.every(s=>['delivered','opened','read','clicked'].includes(s));
  return Math.min(configured,healthy?Math.round(previous*110)/100:previous);
}

// Called under the runner's existing advisory lock. The stored fractional target
// preserves 10% growth while the sending limit rounds down to whole emails.
export async function dailyRampLimit(db,date,{configured=50,readDelivery}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Ramp date invalid');
  if([0,6].includes(new Date(date+'T12:00:00Z').getUTCDay()))throw Error('Ramp is weekdays only');
  campaignLimit({configured,rampTarget:1});
  await db.query(`CREATE TABLE IF NOT EXISTS prospecting_ramp_days (
    run_date DATE PRIMARY KEY,target NUMERIC NOT NULL CHECK(target>=1 AND target<=50),
    status TEXT NOT NULL DEFAULT 'pending',updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const today=(await db.query('SELECT target FROM prospecting_ramp_days WHERE run_date=$1',[date])).rows[0];
  if(today)return Math.floor(nextRampTarget({previous:Number(today.target),configured}));
  const prior=(await db.query('SELECT run_date::text,target,status FROM prospecting_ramp_days WHERE run_date<$1 ORDER BY run_date DESC LIMIT 1',[date])).rows[0];
  let target=Math.min(10,configured);
  if(prior) {
    const attempts=(await db.query(`SELECT a.status,a.email_message_id,s.contact_id FROM prospecting_send_attempts a
      LEFT JOIN prospecting_sequences s ON s.id=a.sequence_id WHERE a.run_date=$1 AND a.sequence_id IS NOT NULL`,[prior.run_date])).rows;
    const statuses=[];
    for(const attempt of attempts) {
      if(attempt.status!=='accepted'||!attempt.email_message_id||!attempt.contact_id){statuses.push('unresolved');continue;}
      try{statuses.push((await readDelivery(attempt)).status);}catch{statuses.push('unresolved');}
    }
    target=nextRampTarget({previous:Number(prior.target),completed:prior.status==='complete',statuses,configured});
  }
  const saved=await db.query(`INSERT INTO prospecting_ramp_days(run_date,target) VALUES($1,$2)
    ON CONFLICT(run_date) DO UPDATE SET target=prospecting_ramp_days.target RETURNING target`,[date,target]);
  return Math.floor(Number(saved.rows[0].target));
}
