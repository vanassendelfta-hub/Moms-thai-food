import { requireRight } from './portal.ts';
const checked=async(q:any)=>{const r=await q;if(r.error)throw r.error;return r.data;};
export function receiptFolder(value:any){if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>3)throw Error('Kies Map 1, 2 of 3');return value;}
export function receiptDate(value:any){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value||Number(value.slice(0,4))<2000||Number(value.slice(0,4))>2100)throw Error('Vul een geldige bondatum in (2000–2100)');return value;}
export function receiptFile(data:any,mime:any){
 const types:any={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 if(!Object.hasOwn(types,mime)||typeof data!=='string'||data.length>6990508||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('Upload een PDF, JPG, PNG of WEBP van maximaal 5 MB');
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));}catch{throw Error('Ongeldig bestand');}
 const starts=(a:number[])=>a.every((n,i)=>bytes[i]===n);
 const valid=mime==='application/pdf'?starts([37,80,68,70,45]):mime==='image/jpeg'?starts([255,216,255]):mime==='image/png'?starts([137,80,78,71,13,10,26,10]):starts([82,73,70,70])&&[87,69,66,80].every((n,i)=>bytes[i+8]===n);
 if(bytes.length<12||bytes.length>5242880||!valid)throw Error('Het bestand komt niet overeen met PDF, JPG, PNG of WEBP');
 return {bytes,extension:types[mime]};
}
export async function receiptAdmin(db:any,body:any,actor:any){
 const a=String(body.action||'');if(!a.startsWith('receipt_'))return null;
 if(a==='receipt_archive_order'){
  requireRight(actor,'orders');return {receipt:await checked(db.rpc('mtf_archive_order',{p_id:body.order_id,p_folder:receiptFolder(body.folder),p_actor:actor.user_id||'eigenaar'}))};
 }
 requireRight(actor,'finance');
 if(a==='receipt_periods')return {periods:await checked(db.rpc('mtf_receipt_periods',{}))};
 if(a==='receipt_list'||a==='receipt_export'){
  const folder=receiptFolder(body.folder),year=Number(body.year),quarter=Number(body.quarter),page=Number(body.page??0);
  if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(quarter)||quarter<1||quarter>4||!Number.isInteger(page)||page<0||page>2000)throw Error('Kies een geldig jaar en kwartaal');
  const query=()=>db.from('mtf_receipts').select('id,folder,document_date,year,quarter,kind,description,amount,order_id,file_name,mime,expense_id,created_at',{count:'exact'}).eq('folder',folder).eq('year',year).eq('quarter',quarter).order('document_date',{ascending:false}).order('id');
  if(a==='receipt_export'){
   const first=await query().range(0,499);if(first.error)throw first.error;if(first.count>10000)throw Error('Dit kwartaal bevat te veel bonnen voor één export');const rows=[...(first.data||[])];
   for(let start=500;start<first.count;start+=500){const next=await query().range(start,start+499);if(next.error)throw next.error;rows.push(...next.data);}
   if(rows.length!==first.count)throw Error('Het overzicht is gewijzigd tijdens exporteren. Probeer het opnieuw.');return {receipts:rows,count:first.count};
  }
  const r=await query().range(page*50,page*50+49);if(r.error)throw r.error;return {receipts:r.data,count:r.count};
 }
 if(a==='receipt_get'){
  const receipt=await checked(db.from('mtf_receipts').select('*').eq('id',body.id).single());
  if(receipt.kind==='upload'){
   if(!receipt.file_path.startsWith(db.location.slug+'/'))throw Error('Geen toegang tot dit bestand');
   const [url,download]=await Promise.all([checked(db.storage.from('mtf-receipts').createSignedUrl(receipt.file_path,600)),checked(db.storage.from('mtf-receipts').createSignedUrl(receipt.file_path,600,{download:receipt.file_name}))]);return {receipt,url:url.signedUrl,download_url:download.signedUrl};
  }return {receipt};
 }
 if(a==='receipt_move')return {receipt:await checked(db.from('mtf_receipts').update({folder:receiptFolder(body.folder),updated_at:new Date().toISOString()}).eq('id',body.id).select('id,folder').single())};
 if(a==='receipt_upload'){
  const folder=receiptFolder(body.folder),date=receiptDate(body.date),description=String(body.description||'').trim(),amount=Number(body.amount);
  if(!description||description.length>200||body.amount===null||body.amount===''||!Number.isFinite(amount)||amount<0||amount>9999999999.99||Math.abs(amount*100-Math.round(amount*100))>0.00001||typeof body.book_expense!=='boolean')throw Error('Vul een omschrijving en een geldig bedrag met maximaal twee decimalen in');
  const {bytes,extension}=receiptFile(body.data,body.mime),id=crypto.randomUUID(),year=date.slice(0,4),quarter=Math.ceil(Number(date.slice(5,7))/3);
  const path=db.location.slug+'/map-'+folder+'/'+year+'/Q'+quarter+'/'+id+'.'+extension;
  const name=String(body.name||'bon.'+extension).replace(/[\x00-\x1f/\\]/g,'_').slice(0,180);
  await checked(db.storage.from('mtf-receipts').upload(path,bytes,{contentType:body.mime,upsert:false}));
  // Keep the object on ambiguous database failures; never remove a file that may have committed.
  const receipt=await checked(db.rpc('mtf_save_receipt_upload',{p_id:id,p_folder:folder,p_date:date,p_description:description,p_amount:amount,p_path:path,p_name:name,p_mime:body.mime,p_book_expense:body.book_expense,p_actor:actor.user_id||'eigenaar'}));
  return {receipt};
 }
 throw Error('Onbekende bonnenactie');
}
