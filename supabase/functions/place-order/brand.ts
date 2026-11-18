/* Merkgegevens van de klant die deze database gebruikt.
   Stel ze per Supabase-project in als Edge Function secrets (MTF_BRAND_NAME enz.).
   Zonder secret gelden de waarden van Mom's Thai Food, de eerste klant, zodat die installatie ongewijzigd blijft.
   Nieuwe klant: alle MTF_*-secrets invullen (zie PLATFORM-NIEUWE-KLANT.md). */
const env=(k:string,d:string)=>((typeof Deno!=='undefined'&&Deno.env.get(k))||'').trim()||d;
export const brand={
 name:env('MTF_BRAND_NAME','Mom’s Thai Food'),
 /* Naam in de afzender van mails (rechte apostrof). */
 mailName:env('MTF_MAIL_NAME',"Mom's Thai Food"),
 siteUrl:env('MTF_SITE_URL','https://momsthaifood.nl'),
 adminUrl:env('MTF_ADMIN_URL','https://bestellen.momsthaifood.nl/admin.html'),
 mailFrom:env('MTF_MAIL_FROM','bestellingen@mail.momsthaifood.nl'),
 replyTo:env('MTF_REPLY_TO','info@momsthaifood.nl'),
 mailDomain:env('MTF_MAIL_DOMAIN','momsthaifood.nl'),
 place:env('MTF_PLACE','Spijkenisse'),
 tagline:env('MTF_TAGLINE','Thais eten bij jou thuis!'),
 color:env('MTF_BRAND_COLOR','#940c0d')
};
