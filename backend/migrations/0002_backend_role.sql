-- A least-privilege database login for the FastAPI backend.
--
-- The backend only needs to read and write ReliefLens rows. It never needs to create tables,
-- change permissions or touch other Supabase schemas, so it should not log in as `postgres`.
-- This creates the role WITHOUT a password (it cannot log in yet). Give it one yourself in the
-- Supabase SQL editor; the password never goes into a migration or into git:
--     alter role relieflens_backend with login password 'a-long-random-password';
-- Then use it in DATABASE_URL (see docs/SUPABASE_SETUP.md).

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'relieflens_backend') then
        create role relieflens_backend nologin;
    end if;
end
$$;

grant usage on schema public to relieflens_backend;

-- Reports and their parts: full read/write, including deleting a report (reviewer "Delete").
grant select, insert, update, delete on public.reports, public.extractions, public.locations
    to relieflens_backend;
-- Audit trail: append and read. Rows are only deleted together with their report; never edited.
grant select, insert, delete on public.audit_log to relieflens_backend;
grant usage, select on sequence public.audit_log_id_seq to relieflens_backend;
-- Settings-like tables are deactivated, never deleted.
grant select, insert, update on public.categories, public.helplines, public.geocode_cache
    to relieflens_backend;

-- Row Level Security is on for every table, so the role also needs policies. It acts for the
-- whole application (the reviewer sign-in is checked in FastAPI), so the policies allow all rows
-- to this role only. `anon` and `authenticated` still have no policies and see nothing.
do $$
declare
    t text;
begin
    foreach t in array array['reports', 'extractions', 'locations', 'audit_log', 'categories', 'helplines',
                             'geocode_cache'] loop
        execute format('drop policy if exists relieflens_backend_all on public.%I', t);
        execute format('create policy relieflens_backend_all on public.%I for all to relieflens_backend '
                       'using (true) with check (true)', t);
    end loop;
end
$$;
