-- Development only (§259): point every stored link to a locally uploaded file
-- at the address the backend serves uploads from NOW.
--
-- With local-disk storage (no R2), a file's full URL is stamped on its row at
-- upload — "http://<this machine's wifi address>:<port>/uploads/…". Both parts
-- change: the address with every new network (§112.7), the port when it moved
-- off 3000. Rows uploaded before then kept the old one and showed a broken
-- image. scripts/dev.sh runs this on every start, with __BASE__ replaced by the
-- current APP_BASE_URL; only the part before /uploads/ changes.
--
-- Every text column of every table, so a new kind of upload needs nothing
-- here. Anchored at the start of the value: only a value that IS such a link
-- is touched. R2 links have no /uploads/ path and are never matched.
DO $$
DECLARE
  c record;
  base text := '__BASE__/uploads/';
BEGIN
  FOR c IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'text' AND table_name <> '_prisma_migrations'
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = regexp_replace(%I, ''^https?://[^/]+/uploads/'', %L) '
      'WHERE %I ~ ''^https?://[^/]+/uploads/'' AND left(%I, length(%L)) <> %L',
      c.table_name, c.column_name, c.column_name, base,
      c.column_name, c.column_name, base, base
    );
  END LOOP;
END $$;
