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
 color:env('MTF_BRAND_COLOR','#940c0d'),
 /* Adres in de voettekst van mails. */
 address:env('MTF_ADDRESS','Winston Churchilllaan · 3202 GN Spijkenisse'),
 /* Logo's in mails. */
 logoUrl:env('MTF_LOGO_URL','https://momsthaifood.nl/logo.png'),
 orderMailLogoUrl:env('MTF_ORDER_MAIL_LOGO_URL','https://uywydquzvdbpfjjrwsbt.supabase.co/storage/v1/object/public/logo/MTF_portret_logo_email.png'),
 /* Kop van de bestelmail, regels gescheiden door |. */
 headerLines:env('MTF_HEADER_LINES',"MOM'S|THAI FOOD").split('|'),
 /* Websiteadressen waarnaar na online betalen mag worden teruggestuurd; de eerste is de standaard. */
 origins:env('MTF_SITE_ORIGINS','https://momsthaifood.nl,https://www.momsthaifood.nl,https://bestellen.momsthaifood.nl,https://moms-thai-food-bestellen.vercel.app').split(',').map(x=>x.trim()).filter(Boolean)
};
/* Hoort deze hostnaam bij de eigen website (voor statistieken: geen externe verwijzer)? */
export const ownHost=(h:string)=>{const d=brand.mailDomain.replace(/^www\./,'');return h===d||h.endsWith('.'+d)||/vercel\.app$/.test(h);};
