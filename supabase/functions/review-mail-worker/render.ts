import { brand } from "./brand.ts";
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function render(name: string, reviewUrl: string, replyTo: string, orderNo = '') {
  const B = brand.name, C = brand.color;
  const subject = name ? `Heeft het gesmaakt, ${name}?` : 'Heeft het gesmaakt?';
  const ref = orderNo ? ` (bestelling ${orderNo})` : '';
  const mail = (stars: number) => 'mailto:' + replyTo + '?subject=' + encodeURIComponent(`Mijn beoordeling: ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}${ref}`) + '&body=' + encodeURIComponent(`Mijn beoordeling: ${stars} van de 5 sterren.\n\nWat vond je ervan?\n\n`);
  const link = (stars: number) => reviewUrl || mail(stars);
  const starRow = [1, 2, 3, 4, 5].map(n => `<a href="${esc(link(n))}" style="text-decoration:none;color:#f5b301;font-size:38px;line-height:1;padding:0 3px" title="${n} ster${n > 1 ? 'ren' : ''}">&#9733;</a>`).join('');
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#fffaf4;font-family:Arial,Helvetica,sans-serif;color:#262222">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #f0e2cf">
<tr><td align="center" style="padding:28px 24px 8px"><img src="${brand.logoUrl}" width="130" alt="${B}" style="display:block;width:130px;max-width:130px;height:auto;border:0"></td></tr>
<tr><td style="padding:8px 32px 0;line-height:1.6;font-size:16px">
<h1 style="color:${C};font-size:24px;text-align:center;margin:8px 0 18px">Heeft het gesmaakt?</h1>
<p>Hoi${name ? ' ' + esc(name) : ''},</p>
<p>Bedankt voor je bestelling bij ${B}! We hopen dat je ervan hebt genoten.</p>
<p>Wil je ons laten weten wat je ervan vond? Klik op het aantal sterren dat je ons geeft. Het kost je maar een paar seconden en je helpt ons er enorm mee.</p>
</td></tr>
<tr><td align="center" style="padding:6px 24px 4px">${starRow}</td></tr>
<tr><td align="center" style="padding:0 24px 18px;font-size:12px;color:#8a7f7f">Klik op een ster</td></tr>
<tr><td align="center" style="padding:0 24px 22px"><a href="${esc(reviewUrl || mail(5))}" style="background:${C};color:#ffffff;padding:14px 26px;display:inline-block;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">Schrijf een review</a></td></tr>
<tr><td style="padding:0 32px 26px;line-height:1.6;font-size:15px">
<p>Was er iets niet goed? Antwoord dan op deze e-mail, dan lossen we het samen op.</p>
<p>Tot de volgende keer!<br><strong>${B}</strong></p>
</td></tr>
<tr><td align="center" style="background:${C};color:#ffffff;padding:14px;border-radius:0 0 14px 14px;font-size:13px">${brand.tagline} · <a href="${brand.siteUrl}/menu" style="color:#f5c766">Bekijk het menu</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hoi${name ? ' ' + name : ''},\n\nBedankt voor je bestelling bij ${B}! We hopen dat je ervan hebt genoten.\n\nHeeft het gesmaakt? Laat het ons weten${reviewUrl ? ': ' + reviewUrl : ' door op deze e-mail te antwoorden met je beoordeling (1 tot 5 sterren).'}\n\nWas er iets niet goed? Antwoord dan op deze e-mail, dan lossen we het samen op.\n\nTot de volgende keer!\n${B}`;
  return { subject, html, text };
}
