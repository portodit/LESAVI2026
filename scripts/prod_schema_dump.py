"""Ambil snapshot skema DB produksi (READ-ONLY) untuk audit drift.

Query hanya SELECT dari information_schema. Tidak ada file yang ditulis ke
server dan tidak ada perubahan ke DB.

    python scripts/prod_schema_dump.py [output.json]
"""

import base64
import pathlib
import re
import sys
import paramiko

ROOT = pathlib.Path(r"C:\Users\Bliad\Documents\GitHub\LESAVI2026")
cred = (ROOT / "scripts" / "ssh_connect.py").read_text(encoding="utf-8")
host = re.search(r'host\s*=\s*"([^"]+)"', cred).group(1)
user = re.search(r'username\s*=\s*"([^"]+)"', cred).group(1)
password = re.search(r'password\s*=\s*"([^"]+)"', cred).group(1)

JS = """
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const q = await client.query(
  "select table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable from information_schema.columns where table_schema='public' order by table_name, ordinal_position"
);
const t = await client.query(
  "select c.relname as name, c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m') order by 1"
);
console.log(JSON.stringify({ columns: q.rows, tables: t.rows }));
await client.end();
"""

b64 = base64.b64encode(JS.encode()).decode()
cmd = (
    "cd /var/www/lesavi && node --env-file=.env "
    '-e "$(echo ' + b64 + ' | base64 -d)"'
)

out_file = sys.argv[1] if len(sys.argv) > 1 else str(
    pathlib.Path.home() / "AppData/Local/Temp/prod_cols.json"
)

with paramiko.SSHClient() as c:
    c.load_system_host_keys()
    c.set_missing_host_key_policy(paramiko.RejectPolicy())
    key_file = pathlib.Path.home() / ".ssh" / "lesavi_deploy"
    if key_file.exists():
        c.connect(host, port=22, username=user, key_filename=str(key_file), timeout=15)
    else:
        c.connect(host, port=22, username=user, password=password, timeout=15)
    _, stdout, stderr = c.exec_command(cmd, timeout=180)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")

if err.strip():
    print("STDERR:", err[:1500])
pathlib.Path(out_file).write_text(out, encoding="utf-8")
print(f"snapshot -> {out_file} ({len(out)} byte)")
