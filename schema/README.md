# Schema snapshot

`public-snapshot.json` lists the production `public` tables, columns, and RPC
signatures this server actually uses. `pnpm check:schema-usage` reads it and
fails when the code names a table, column, or RPC argument production does not
have.

SIG-2672: the SIG-2318 vocabulary renames (`product_id` -> `workspace_id`,
`database_folders` -> `agents`, `product_capability_overrides` ->
`workspace_capability_overrides`, `product_goals` -> the
`get_workspace_brand_profile` RPC) broke every tool-mode call while the
FakeSupabase suite stayed green, because those fixtures answer any table or
column name. This snapshot is the tripwire for the next rename.

Refresh it from production (read-only) after a rename lands:

```sql
select json_object_agg(t.table_name, t.cols) from (
  select c.table_name, json_agg(c.column_name order by c.column_name) as cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name in (<tables this server reads>)
  group by c.table_name) t;

select p.proname, pg_get_function_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (<rpcs this server calls>);
```
