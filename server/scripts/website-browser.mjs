import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { chromium } from 'playwright';
import { publicAddress,readPublicPage,pageText,registeredNumber } from './website-evidence.mjs';
import { domainKey,companyKey } from './outreach-policy.mjs';
import { escapeHtml,websiteFindings } from './website-policy.mjs';

export async function publicResource(input,redirects=0) {
  const u=new URL(input);
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||isIP(u.hostname)||redirects>3) throw Error('Resource URL disallowed');
  let dnsTimer;
  const addresses=await Promise.race([lookup(u.hostname,{all:true}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(Error('Resource DNS timeout')),10000);})]).finally(()=>clearTimeout(dnsTimer));
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address))) throw Error('Resource address disallowed');
  const address=addresses[0];
  const resource=await new Promise((resolve,reject)=>{
    const request=https.get(u,{agent:false,headers:{'User-Agent':'Proxaim website preview review (+https://proxaim.com)'},lookup:(_host,options,cb)=>options.all?cb(null,[address]):cb(null,address.address,address.family)},response=>{
      if([301,302,303,307,308].includes(response.statusCode)){response.resume();resolve({redirect:response.headers.location});return;}
      if(response.statusCode!==200){response.resume();reject(Error('Resource unavailable'));return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>2_000_000)request.destroy(Error('Resource too large'));else chunks.push(chunk);});
      response.on('error',()=>reject(Error('Resource interrupted')));
      response.on('end',()=>resolve({body:Buffer.concat(chunks),contentType:String(response.headers['content-type']||'application/octet-stream')}));
    });
    const timer=setTimeout(()=>request.destroy(Error('Resource timeout')),15000);
    request.on('close',()=>clearTimeout(timer));request.on('error',()=>reject(Error('Resource request failed')));
  });
  return resource.redirect?publicResource(new URL(resource.redirect,u).href,redirects+1):resource;
}
export async function openWebsiteBrowser() {
  return chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
}
export async function inspectWebsite(browser,url,{clinical=false}={}) {
  const source=await readPublicPage(url);
  const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'});
  let requests=0,failedStyles=0;
  await context.route('**/*',async route=>{
    const request=route.request();
    if(++requests>60||!['stylesheet','image','font','document'].includes(request.resourceType())||(clinical&&request.resourceType()==='image')){if(request.resourceType()==='stylesheet')failedStyles++;return route.abort();}
    try {
      if(request.resourceType()==='document') {
        if(request.url()!==source.url)return route.abort();
        return route.fulfill({status:200,contentType:'text/html',body:source.html});
      }
      const asset=await publicResource(request.url());
      if(!/^(?:image\/|text\/css|font\/|application\/(?:font|x-font))/i.test(asset.contentType))return route.abort();
      await route.fulfill({status:200,contentType:asset.contentType,body:asset.body});
    } catch {if(request.resourceType()==='stylesheet')failedStyles++;await route.abort();}
  });
  const page=await context.newPage();
  const captures=[];
  try {
    for(const viewport of [{width:1440,height:960},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      await page.goto(source.url,{waitUntil:'load',timeout:30000});
      const data=await page.evaluate(({clinical})=>{
        const links=Array.from(document.querySelectorAll('a[href]')).map(a=>({text:(a.textContent||'').trim().slice(0,100),href:a.href}));
        const text=clinical?'':document.body.innerText.slice(0,100000);
        const headings=Array.from(document.querySelectorAll('h1,h2,h3')).map(h=>h.textContent.trim()).filter(Boolean).slice(0,30);
        const logo=Array.from(document.images).find(i=>/logo/i.test(i.alt+' '+i.className+' '+i.src)&&!/rics|gdc|gmc|trustpilot|certificate/i.test(i.alt+' '+i.src)&&(clinical||i.naturalWidth>0));
        const photo=clinical?null:Array.from(document.querySelectorAll('main img, .hero img')).find(i=>i.naturalWidth>=500&&!/logo|badge|icon/i.test(i.alt+' '+i.src));
        const accent=Array.from(document.querySelectorAll('a,button')).map(a=>getComputedStyle(a).backgroundColor).find(c=>c!=='rgba(0, 0, 0, 0)'&&c!=='rgb(255, 255, 255)'&&c!=='rgb(0, 0, 0)');
        return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,text,headings,links,logo:logo?.src||null,photo:photo?.src||null,accent:accent||null,emails:Array.from(new Set((document.body.innerText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(e=>e.toLowerCase())))};
      },{clinical});
      if(clinical) await page.addStyleTag({content:'img,video,canvas,blockquote,[class*="testimonial"],[class*="review"]{visibility:hidden!important} *{background-image:none!important}'});
      captures.push({...data,screenshot:await page.screenshot({type:'jpeg',quality:65}),clinicalImagesMasked:clinical});
    }
    if(failedStyles)throw Error('Original styles could not be loaded; no layout judgement made');
    return {source,desktop:captures[0],mobile:captures[1],findings:websiteFindings(captures[0],captures[1])};
  } finally {await context.close();}
}
export async function corporateWebsite(source,company) {
  const pages=[source];const domain=domainKey(source.url);
  for(const href of [...source.html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]).filter(s=>/contact|legal|privacy|terms/i.test(s)).slice(0,6)) {
    if(pages.length>=4)break;
    try {const u=new URL(href,source.url);if(domainKey(u.href)===domain)pages.push(await readPublicPage(u.href,domain));}catch{}
  }
  const numbers=[...new Set(pages.map(p=>registeredNumber(p.html)).filter(Boolean))];
  let corporate={verified:false};
  if(numbers.length===1) {
    try {
      const registry=await readPublicPage('https://find-and-update.company-information.service.gov.uk/company/'+numbers[0],'find-and-update.company-information.service.gov.uk');
      const text=pageText(registry.html),title=(registry.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').split(/\s+overview\s*/i)[0].trim();
      if(title&&/Company status\s+Active/i.test(text)&&text.includes(numbers[0])&&pages.some(p=>companyKey(pageText(p.html)).includes(companyKey(title))))corporate={verified:true,companyNumber:numbers[0],legalName:title,sourceUrl:registry.url};
    }catch{}
  }
  const published=pages.flatMap(p=>(p.html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(email=>({email:email.toLowerCase(),source:p.url})));
  const mailbox=published.find(p=>domainKey(p.email.split('@')[1])===domain&&/^(info|hello|office|enquiries|inquiries|contact|admin|survey|reception)$/.test(p.email.split('@')[0]));
  let professional={verified:false};
  const directoryLink=pages.flatMap(p=>[...p.html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1])).find(h=>/^https:\/\/(?:www\.)?ricsfirms\.com\/office\//i.test(h));
  if(directoryLink)try {const listing=await readPublicPage(directoryLink,'ricsfirms.com');if(companyKey(pageText(listing.html)).includes(companyKey(company)))professional={verified:true,sourceUrl:listing.url};}catch{}
  return {corporate,professional,email:mailbox?.email||null,emailSourceUrl:mailbox?.source||null,company};
}
export function buildWebsite(candidate,inspection) {
  const clinical=/dent|medical|clinic/i.test(candidate.sector);
  const logo=inspection.desktop.logo;
  const colour=inspection.desktop.accent||'#1b4652';
  const services=inspection.desktop.links.filter(a=>/service|survey|roof|heating|treatment|consultation/i.test(a.text)&&domainKey(a.href)===candidate.domain).slice(0,6);
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(candidate.company)} | Website concept</title><style>*{box-sizing:border-box}body{margin:0;color:#172c34;background:#f6f8f7;font:18px/1.6 Arial,sans-serif}header,main,footer{max-width:1100px;margin:auto;padding:28px}header{display:flex;align-items:center;gap:24px;flex-wrap:wrap}img{max-width:180px;max-height:85px}h1{font-size:clamp(38px,6vw,76px);line-height:1.1;overflow-wrap:anywhere}h2{font-size:30px}a{color:${colour};overflow-wrap:anywhere}.cta{display:inline-block;background:${colour};color:white;padding:14px 24px;border-radius:8px;margin:8px 8px 8px 0}.services{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}.card{background:white;padding:24px;border-radius:12px}.note{font-size:14px;color:#53666e}footer{border-top:1px solid #ddd}</style></head><body><header>${logo?`<img src="${escapeHtml(logo)}" alt="${escapeHtml(candidate.company)} logo">`:''}<strong>${escapeHtml(candidate.company)}</strong><a href="#contact">Contact</a></header><main><p class="note">Private website concept. Prepared using public business details.</p><h1>${escapeHtml(candidate.company)}</h1><p>Explore services and get in touch with the team.</p><a class="cta" href="mailto:${escapeHtml(candidate.email)}">Email the team</a><a class="cta" href="${escapeHtml(candidate.website)}">Visit the current website</a><h2>Services and information</h2><div class="services">${services.map(s=>`<article class="card"><a href="${escapeHtml(s.href)}">${escapeHtml(s.text)}</a><p class="note">Read the details on the business's current website.</p></article>`).join('')}</div><section id="contact"><h2>Contact ${escapeHtml(candidate.company)}</h2><p><a href="mailto:${escapeHtml(candidate.email)}">${escapeHtml(candidate.email)}</a></p></section></main><footer><p class="note">This concept has no live enquiry form. ${clinical?'No patient imagery or clinical claims have been added.':''}</p></footer></body></html>`;
  const photo=clinical?null:inspection.desktop.photo;
  const brandedHtml=photo?html.replace('</style>','.hero{max-width:100%;width:100%;max-height:380px;object-fit:cover;border-radius:12px}</style>').replace('<h2>Services and information</h2>',`<img class="hero" src="${escapeHtml(photo)}" alt="Image from ${escapeHtml(candidate.company)}'s current website"><h2>Services and information</h2>`):html;
  return {html:brandedHtml,manifest:{originalLogo:logo,originalPhoto:photo,observedBrandColour:inspection.desktop.accent,designFallback:!inspection.desktop.accent,stockUsed:false,sourceUrl:candidate.website,sector:candidate.sector}};
}
export async function verifyPreview(browser,html,email) {
  const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'});
  await context.route('**/*',async route=>{
    if(route.request().resourceType()!=='image')return route.abort();
    try{const asset=await publicResource(route.request().url());if(!asset.contentType.startsWith('image/'))return route.abort();await route.fulfill({status:200,contentType:asset.contentType,body:asset.body});}catch{await route.abort();}
  });
  try {
    const page=await context.newPage();await page.setViewportSize({width:390,height:844});await page.setContent(html);
    const result=await page.evaluate(email=>({overflow:document.documentElement.scrollWidth>innerWidth+2,contact:Array.from(document.querySelectorAll('a')).some(a=>a.getAttribute('href')==='mailto:'+email),imagesLoaded:Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)}),email);
    if(result.overflow||!result.contact||!result.imagesLoaded)throw Error('Preview QA failed');
    return await page.screenshot({type:'jpeg',quality:65});
  } finally {await context.close();}
}
