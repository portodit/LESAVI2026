import paramiko
import sys
import io

host = "103.183.74.104"
port = 22
username = "ivalora"
password = "Sura123Baya45"

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, port=port, username=username, password=password, timeout=10)

commands = [
    "tail -15 /var/www/lesavi/api-out.log",
    "pm2 pid lesavi-api",
]

for cmd in commands:
    print(f"\n$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        print(out)
    if err.strip():
        print(f"[ERR] {err}")

client.close()
