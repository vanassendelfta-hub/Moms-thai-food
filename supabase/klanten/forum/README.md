# Forum Cateringservice (pilot)

Demo voor Forum Cateringservice, Spijkenisse. Branch `klant-forum`, Supabase-project `xxctsddwduviiqpzlsij` ("Pilot Restaurant").

- Schema: `supabase/platform/0001_schema_public.sql` met merknaam "Forum Cateringservice", daarna een ingekorte `0002_bootstrap.sql`
  (openingstijden ma, do t/m zo 12:00–20:30, vestiging `spijkenisse`, voorvoegsel FC; geen mail-cron en geen kluisgeheim: demo zonder mail).
- Menu: `seed_menu_demo.sql`, 143 van de 479 gerechten (ongeveer 30%), met keuze nasi/bami/witte rijst en de toeslagen als extra's.
- Bezorgregels in deze branch (`order-rules.js`): vaste € 3,50, geen minimum. Bezorgzones per plaats volgen als platformaanpassing.
- Geen Mollie, geen Resend: er wordt niets betaald of gemaild.
