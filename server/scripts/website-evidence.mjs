import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { domainKey, emailKey, companyKey } from './outreach-policy.mjs';
const blocked = new BlockList();
for (const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,prefix,'ipv4');
blocked.addSubnet('2001:db8::',32,'ipv6');
export function publicAddress(address) {
  const type = isIP(address);
  return type === 4 ? !blocked.check(address,'ipv4') : type === 6 && /^[23]/.test(address) && !blocked.check(address,'ipv6');
}
export async function readPublicPage(input, expectedDomain = domainKey(input), redirects = 0) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || domainKey(url.href) !== expectedDomain || isIP(url.hostname)) throw new Error('Website URL disallowed');
  let timer;
  const addresses = await Promise.race([lookup(url.hostname,{all:true}), new Promise((_,reject)=> { timer=setTimeout(()=>reject(new Error('Website DNS timeout')),10000); })]).finally(()=>clearTimeout(timer));
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Website address disallowed');
  const address = addresses[0];
  const result = await new Promise((resolve,reject) => {
    const request = https.get(url,{ agent:false, headers:{'User-Agent':'Proxaim website review (+https://proxaim.com)','Accept':'text/html'},
      lookup:(_host,options,callback) => options.all ? callback(null,[address]) : callback(null,address.address,address.family) },response => {
      const type = String(response.headers['content-type'] || '');
      if ([301,302,303,307,308].includes(response.statusCode)) { response.resume(); resolve({redirect:response.headers.location}); return; }
      if (response.statusCode !== 200 || !/text\/html/i.test(type)) { response.resume(); reject(new Error('Website page unreadable')); return; }
      const chunks = []; let bytes=0;
      response.on('data',chunk=> { bytes+=chunk.length; if (bytes>750000) request.destroy(new Error('Website response too large')); else chunks.push(chunk); });
      response.on('error',()=>reject(new Error('Website response interrupted')));
      response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8'),url:url.href,headers:{csp:response.headers['content-security-policy'] || null}}));
    });
    request.setTimeout(15000,()=>request.destroy(new Error('Website request timeout')));
    const deadline=setTimeout(()=>request.destroy(new Error('Website request deadline')),20000);
    request.on('close',()=>clearTimeout(deadline));
    request.on('error',()=>reject(new Error('Website request failed')));
  });
  if (result.redirect) {
    if (redirects>=3) throw new Error('Website redirect limit');
    return readPublicPage(new URL(result.redirect,url).href,expectedDomain,redirects+1);
  }
  return result;
}
export const pageText = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|quot|apos);/g,' ').replace(/\s+/g,' ').trim();
export function homepageObservation(html,headers) {
  if (!/<\/body\s*>/i.test(html)) return null;
  const source = html.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  const metas=(source.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) || []).map(tag=>{
    const attrs={};for(const m of tag.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g)) attrs[m[1].toLowerCase()]=(m[2] ?? m[3] ?? m[4]).trim();
    return attrs;
  });
  const description=metas.some(a=>a.name?.toLowerCase()==='description' && a.content);
  if(!description) return {route:'visibility',observation:'the short description field (meta description) was empty or missing in the page HTML I checked'};
  const ogImage=metas.some(a=>['og:image','og:image:url','og:image:secure_url'].includes((a.property || a.name || '').toLowerCase()) && a.content);
  if(!ogImage) return {route:'visibility',observation:'I could not find an image specified for link previews (an Open Graph image tag) in the page HTML I checked'};
  if(headers && headers.csp===null && !metas.some(a=>a['http-equiv']?.toLowerCase()==='content-security-policy')) return {route:'security',observation:'the page response I checked did not include a Content-Security-Policy header'};
  return null;
}
export function registeredNumber(html) {
  const text = pageText(html);
  const matches = [...text.matchAll(/(?:company\s+(?:registration\s+)?(?:number|no\.?|reg\.?\s*no\.?)|registered\s+in\s+scotland)[\s\S]{0,90}?\b((?:SC|SO)\d{6}|\d{8})\b/gi)].map(m=>m[1].toUpperCase());
  return [...new Set(matches)].length === 1 ? matches[0] : null;
}
export async function qualifyWebsite(score, company, {read = readPublicPage, now = new Date()} = {}) {
  const domain = domainKey(score.website);
  if (!domain) return {hold:'missing-business-website'};
  if (!/\b(?:Glasgow|Edinburgh|Aberdeen|Dundee|Inverness|Stirling|Perth|Scotland)\b/i.test(score.address || '')
      && !/\b(?:AB|DD|DG|EH|FK|G|HS|IV|KA|KW|KY|ML|PA|PH|ZE)\d{1,2}\s*\d[A-Z]{2}\b/i.test(score.address || '')) return {hold:'scottish-business-address-unverified'};
  const homeUrl = new URL(score.website); homeUrl.protocol='https:'; homeUrl.hash='';
  const home = await read(homeUrl.href,domain);
  const observation = homepageObservation(home.html,home.headers);
  if (!observation) return {hold:'no-approved-evidenced-route'};
  const pages = [home];
  const links = [...home.html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]).filter(h=>/contact|privacy|legal|terms/i.test(h));
  const visited = new Set([home.url]);
  for (const link of links) {
    if (pages.length>=4) break;
    const url = new URL(link,home.url);
    if (url.protocol!=='https:' || domainKey(url.href)!==domain || visited.has(url.href)) continue;
    visited.add(url.href);
    try { pages.push(await read(url.href,domain)); } catch { /* Missing supplementary evidence holds below. */ }
  }
  // The scanner may select a named address or miss a generic one. Discover an
  // actually published generic mailbox from the checked pages instead of inventing it.
  const published=pages.flatMap(p=>(p.html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(emailKey));
  const emails=[...new Set(published)].filter(e=>{
    const parts=e.split('@');return parts.length===2 && domainKey(parts[1])===domain && /^(info|hello|office|enquiries|inquiries|contact)$/.test(parts[0]);
  });
  const email=emails.includes(emailKey(score.email))?emailKey(score.email):emails[0];
  if(!email) return {hold:'no-published-generic-business-email'};
  const emailPage = pages.find(p=>p.html.toLowerCase().includes(email));
  if (!emailPage) return {hold:'email-not-published-on-business-site'};
  const numbered = pages.map(p=>({page:p,number:registeredNumber(p.html)})).filter(p=>p.number);
  const numbers = [...new Set(numbered.map(n=>n.number))];
  if (numbers.length!==1) return {hold:'corporate-registration-unverified'};
  const registryUrl = 'https://find-and-update.company-information.service.gov.uk/company/' + numbers[0];
  const registry = await read(registryUrl,'find-and-update.company-information.service.gov.uk');
  const text = pageText(registry.html);
  const title = (registry.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').split(/\s+overview\s*/i)[0].trim();
  if (!title || !/\bCompany status\s+Active\b/i.test(text) || !text.includes(numbers[0])) return {hold:'active-company-unverified'};
  if (!pages.some(p=>companyKey(pageText(p.html)).includes(companyKey(title)))) return {hold:'registered-company-website-match-unverified'};
  return {candidate:{company,domain,email,address:score.address,website:home.url,route:observation.route,
    corporate:{verified:true,companyNumber:numbers[0],legalName:title,sourceUrl:registry.url,websiteSourceUrl:numbered[0].page.url},
    emailPublished:true,emailSourceUrl:emailPage.url,
    evidence:{observation:observation.observation,sourceUrl:home.url,checkedAt:now.toISOString(),sha256:createHash('sha256').update(home.html).digest('hex')},
    validation:null}};
}
