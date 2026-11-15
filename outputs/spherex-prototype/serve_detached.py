"""Start server.py with no console, for a server that must stay up (the shared link). Windows only.

A server started from a terminal shares that terminal's console, and a Ctrl+C sent
there stops it without a traceback. On 2026-11-14 this stopped servers started from
agent terminals each time the active terminal changed. A process with no console
cannot receive a Ctrl+C.

Usage: python serve_detached.py <port>
Run it with the interpreter and environment (PYTHONPATH, Supabase variables) the server needs.
Logs to work/server-<port>.log. Stop the server with: taskkill /PID <pid> /T /F
"""
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
port = str(int(sys.argv[1]))
# The shared link must refuse file imports and must not trim the demo frames, so both default on
env = dict(os.environ)
env.setdefault('SPHEREX_PUBLIC', '1')
env.setdefault('SPHEREX_CACHE_GB', '50')
log_path = root.parent.parent / 'work' / f'server-{port}.log'
log_path.parent.mkdir(exist_ok=True)
with open(log_path, 'ab') as log:
    child = subprocess.Popen([sys.executable, '-X', 'utf8', 'server.py', '--port', port], cwd=root, env=env,
                             stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                             creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
print(f'server pid {child.pid}, log {log_path}')
