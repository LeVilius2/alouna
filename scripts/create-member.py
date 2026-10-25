#!/usr/bin/env python3
"""Run as root on the Alouna VPS. Passwords are entered by the owner, never argv/env/logs."""
import argparse
import getpass
import ipaddress
import json
import re
import subprocess
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--stack', required=True, help='Coolify Supabase service UUID')
parser.add_argument('--email', help='Omit to enter the email interactively')
parser.add_argument('--role', choices=['admin', 'walker'], default='walker')
parser.add_argument('--name', default='')
parser.add_argument('--reset-password', action='store_true', help='Reset an existing account password')
args = parser.parse_args()
args.email = args.email or input('Alouna account email: ').strip()
if not re.fullmatch(r'[a-z0-9]{20,32}', args.stack) or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', args.email):
    parser.error('Invalid service UUID or email address')


def inspect(service):
    return json.loads(subprocess.check_output(['docker', 'inspect', f'{service}-{args.stack}']))[0]


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def sql(statement):
    return subprocess.check_output(
        ['docker', 'exec', '-i', f'supabase-db-{args.stack}', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
        input=statement.encode(),
    ).decode().strip()


kong = inspect('supabase-kong')
auth = inspect('supabase-auth')
key = dict(value.split('=', 1) for value in kong['Config']['Env']).get('SUPABASE_SERVICE_KEY')
if not key:
    raise SystemExit('The private API service key is unavailable')
address = next((network['IPAddress'] for network in auth['NetworkSettings']['Networks'].values() if network['IPAddress']), None)
ipaddress.ip_address(address)
existing = sql(f'select id from auth.users where lower(email)=lower({quote(args.email)});')
if existing and not args.reset_password:
    raise SystemExit('Account already exists. Use --reset-password only when a password reset is intended.')
password = getpass.getpass('New Alouna password (hidden): ')
if len(password) < 12:
    raise SystemExit('Use a password of at least 12 characters.')
if getpass.getpass('Repeat password (hidden): ') != password:
    raise SystemExit('Passwords did not match. No account was changed.')
body = {'password': password}
method, path = ('PUT', f'/admin/users/{uuid.UUID(existing)}') if existing else ('POST', '/admin/users')
if not existing:
    body.update(email=args.email, email_confirm=True)
request = urllib.request.Request(f'http://{address}:9999{path}', data=json.dumps(body).encode(), method=method,
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        user = json.load(response)
except urllib.error.HTTPError as error:
    raise SystemExit(f'Auth rejected the request (HTTP {error.code}). No membership was granted.') from None
finally:
    password = ''
    body.clear()
user_id = str(uuid.UUID(user['id']))
sql(f"insert into public.profiles(id,display_name,role,active) values ({quote(user_id)},{quote(args.name or args.email.split('@')[0])},{quote(args.role)},true) on conflict(id) do update set display_name=excluded.display_name,role=excluded.role,active=true;")
print(f'Account ready: {args.email} ({args.role}). Sign in at https://alouna.leveris.lt/editor')
