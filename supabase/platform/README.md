# Platformbestanden voor een nieuwe klantdatabase

| Bestand | Wat |
|---|---|
| `0001_schema_public.sql` | Volledig schema van de hoofdvestiging (tabellen, controles, functies, triggers, beveiligingsregels, rechten). `{{MERKNAAM}}` invullen. |
| `0002_bootstrap.sql` | Extensies, opslagmappen, startinstellingen (alles uit), hoofdvestiging en geplande mailtaken. `{{...}}` invullen. |
| `location_schema_template.sql` | Schema voor een extra vestiging. `__LOCATION_SCHEMA__` vervangen. |

Gegenereerd op 18-11-2026 uit de testdatabase (ipbvjszctqgtidcouidc), inclusief fase 4a.
Getest door het schema in een lege kopie op te bouwen en het opstartgedeelte met testwaarden uit te voeren
(40 tabellen, 43 functies, 171 controles, 2 regels, 12 triggers; extra vestiging 26 tabellen, 20 functies), daarna teruggedraaid.

## Opnieuw genereren

De generatoren staan in de testdatabase in schema `platform_tools`:

```sql
select platform_tools.schema_ddl('public', null);                 -- 0001_schema_public.sql
select platform_tools.bootstrap_sql();                            -- 0002_bootstrap.sql
select replace(platform_tools.schema_ddl('mtf_ob','__LOCATION_SCHEMA__'), 'mtf_ob.', '__LOCATION_SCHEMA__.');  -- sjabloon
```

Hun broncode staat in `platform_tools.sql` hiernaast.
Na genereren: controleren op geheimen en merknaam (`grep -i "mom.s thai"`), en vervangen door `{{MERKNAAM}}`.
