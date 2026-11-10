#!/usr/bin/env python3
"""Small HTTP bridge between the Play Trainer and the akochan mahjong engine.

Each game gets its own long-running `system.exe pipe_detailed <tactics> 0` process. The browser streams the
game's mjai events (seat 0 = the human, other hands masked) and akochan prints one JSON line per review point:
the human's own draws, and every discard / added kan by an opponent. Results are kept in order so the browser
can ask for "review point #n".

    POST /api/akochan/session                 -> {"id": ...}
    POST /api/akochan/events  {id, start, events}  -> {"count", "reviews"}
    GET  /api/akochan/result?id=..&n=..&wait=20 -> {"status": "ready", "actions": [...]} | {"status": "pending"}
    POST /api/akochan/close   {id}
    GET  /api/akochan/health

Standard library only. Configuration (environment variables):
    AKOCHAN_DIR      akochan checkout containing system.exe and libai.so   (default /opt/akochan)
    AKOCHAN_TACTICS  tactics json passed to akochan                       (default $AKOCHAN_DIR/tactics.json)
    AKOCHAN_CMD      full command override, e.g. for a stub engine during development
    AKOCHAN_THREADS  OMP_NUM_THREADS for akochan                          (default: all cores)
    API_HOST / API_PORT  listen address                                   (default 127.0.0.1:8091)
    MAX_SESSIONS     concurrent games                                     (default 3)
Run with --static DIR to also serve the site itself (handy for local testing without nginx).
"""
import argparse
import json
import os
import shlex
import subprocess
import threading
import time
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

AKOCHAN_DIR = os.environ.get('AKOCHAN_DIR', '/opt/akochan')
AKOCHAN_TACTICS = os.environ.get('AKOCHAN_TACTICS', os.path.join(AKOCHAN_DIR, 'tactics.json'))
AKOCHAN_CMD = os.environ.get('AKOCHAN_CMD')
MAX_SESSIONS = int(os.environ.get('MAX_SESSIONS', '3'))
IDLE_TIMEOUT = 30 * 60
MAX_BODY = 512 * 1024
ALLOWED_TYPES = {
    'start_game', 'start_kyoku', 'tsumo', 'dahai', 'reach', 'reach_accepted', 'chi', 'pon', 'daiminkan',
    'kakan', 'ankan', 'dora', 'hora', 'ryukyoku', 'end_kyoku', 'end_game',
}
PLAYER_ID = 0


def is_review_point(ev):
    """Mirrors akochan's pipe_detailed: it analyses (and prints a line) at exactly these events."""
    actor = ev.get('actor')
    if actor is None:
        return False
    if actor == PLAYER_ID:
        return ev.get('type') == 'tsumo'
    return ev.get('type') in ('dahai', 'kakan')


def engine_command():
    if AKOCHAN_CMD:
        return shlex.split(AKOCHAN_CMD), None
    return [os.path.join(AKOCHAN_DIR, 'system.exe'), 'pipe_detailed', AKOCHAN_TACTICS, str(PLAYER_ID)], AKOCHAN_DIR


class Session:
    def __init__(self):
        self.id = uuid.uuid4().hex
        self.count = 0          # events received
        self.reviews = 0        # review points sent to the engine
        self.results = []       # one entry per review point, in order
        self.error = None
        self.last_used = time.time()
        self.cond = threading.Condition()
        self.write_lock = threading.Lock()
        cmd, cwd = engine_command()
        env = dict(os.environ)
        if cwd:
            env['LD_LIBRARY_PATH'] = cwd + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
        if os.environ.get('AKOCHAN_THREADS'):
            env['OMP_NUM_THREADS'] = os.environ['AKOCHAN_THREADS']
        self.proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, bufsize=1)
        self.stderr_tail = []
        self.sent_at = []
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def _read_stdout(self):
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                actions = json.loads(line)
            except ValueError:
                actions = None
            with self.cond:
                n = len(self.results)
                took = time.time() - self.sent_at[n] if n < len(self.sent_at) else None
                if actions is None:
                    self.results.append({'error': 'unparseable engine output', 'raw': line[:2000]})
                else:
                    self.results.append({'actions': actions, 'seconds': round(took, 3) if took is not None else None})
                self.cond.notify_all()
        with self.cond:
            code = self.proc.wait()
            self.error = self.error or f'akochan exited with code {code}: ' + ' | '.join(self.stderr_tail[-5:])
            self.cond.notify_all()

    def _read_stderr(self):
        for line in self.proc.stderr:
            self.stderr_tail.append(line.rstrip()[:300])
            del self.stderr_tail[:-20]

    def feed(self, start, events):
        with self.write_lock:
            if self.error:
                raise RuntimeError(self.error)
            if start != self.count:
                return False
            for ev in events:
                line = json.dumps(ev, separators=(',', ':'))
                if is_review_point(ev):
                    with self.cond:
                        self.sent_at.append(time.time())
                    self.reviews += 1
                self.proc.stdin.write(line + '\n')
                self.count += 1
            self.proc.stdin.flush()
            self.last_used = time.time()
            return True

    def result(self, n, wait):
        deadline = time.time() + wait
        with self.cond:
            while len(self.results) <= n and not self.error:
                left = deadline - time.time()
                if left <= 0:
                    return {'status': 'pending', 'ready': len(self.results), 'reviews': self.reviews}
                self.cond.wait(left)
            self.last_used = time.time()
            if len(self.results) > n:
                r = self.results[n]
                if 'error' in r:
                    return {'status': 'error', 'message': r['error'], 'raw': r.get('raw')}
                return {'status': 'ready', 'actions': r['actions'], 'seconds': r['seconds']}
            return {'status': 'error', 'message': self.error}

    def close(self):
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.kill()


sessions = {}
sessions_lock = threading.Lock()


def reaper():
    while True:
        time.sleep(60)
        now = time.time()
        with sessions_lock:
            stale = [s for s in sessions.values() if now - s.last_used > IDLE_TIMEOUT]
            for s in stale:
                sessions.pop(s.id, None)
        for s in stale:
            s.close()


class Handler(SimpleHTTPRequestHandler):
    static_dir = None
    server_version = 'akochan-bridge/1.0'

    def log_message(self, fmt, *args):
        if self.path.startswith('/api/'):
            super().log_message(fmt, *args)

    def send_json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_BODY:
            raise ValueError('request too large')
        return json.loads(self.rfile.read(length) or b'{}')

    def session(self, sid):
        with sessions_lock:
            return sessions.get(sid)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/api/akochan/health':
            cmd, _ = engine_command()
            return self.send_json({'ok': AKOCHAN_CMD is not None or os.path.exists(cmd[0]), 'engine': cmd[0],
                                   'tactics': AKOCHAN_TACTICS, 'sessions': len(sessions), 'maxSessions': MAX_SESSIONS})
        if url.path == '/api/akochan/result':
            q = parse_qs(url.query)
            s = self.session(q.get('id', [''])[0])
            if not s:
                return self.send_json({'status': 'gone'}, HTTPStatus.NOT_FOUND)
            n = int(q.get('n', ['0'])[0])
            wait = min(25.0, max(0.0, float(q.get('wait', ['20'])[0])))
            return self.send_json(s.result(n, wait))
        if url.path.startswith('/api/'):
            return self.send_json({'error': 'not found'}, HTTPStatus.NOT_FOUND)
        if self.static_dir:
            return super().do_GET()
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        url = urlparse(self.path)
        try:
            body = self.read_json()
        except ValueError as e:
            return self.send_json({'error': str(e)}, HTTPStatus.BAD_REQUEST)
        if url.path == '/api/akochan/session':
            with sessions_lock:
                if len(sessions) >= MAX_SESSIONS:  # private site: make room by dropping the least recently used game
                    oldest = min(sessions.values(), key=lambda s: s.last_used)
                    sessions.pop(oldest.id, None)
                    oldest.close()
                try:
                    s = Session()
                except OSError as e:
                    return self.send_json({'error': f'cannot start akochan: {e}'}, HTTPStatus.SERVICE_UNAVAILABLE)
                sessions[s.id] = s
            return self.send_json({'id': s.id})
        if url.path == '/api/akochan/events':
            s = self.session(body.get('id', ''))
            if not s:
                return self.send_json({'status': 'gone'}, HTTPStatus.NOT_FOUND)
            events = body.get('events') or []
            if not isinstance(events, list) or any(not isinstance(e, dict) or e.get('type') not in ALLOWED_TYPES for e in events):
                return self.send_json({'error': 'bad events'}, HTTPStatus.BAD_REQUEST)
            try:
                ok = s.feed(int(body.get('start', -1)), events)
            except (RuntimeError, OSError) as e:
                return self.send_json({'status': 'error', 'message': str(e)}, HTTPStatus.BAD_GATEWAY)
            if not ok:
                return self.send_json({'status': 'out_of_sync', 'count': s.count}, HTTPStatus.CONFLICT)
            return self.send_json({'count': s.count, 'reviews': s.reviews})
        if url.path == '/api/akochan/close':
            with sessions_lock:
                s = sessions.pop(body.get('id', ''), None)
            if s:
                s.close()
            return self.send_json({'ok': True})
        self.send_json({'error': 'not found'}, HTTPStatus.NOT_FOUND)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--host', default=os.environ.get('API_HOST', '127.0.0.1'))
    ap.add_argument('--port', type=int, default=int(os.environ.get('API_PORT', '8091')))
    ap.add_argument('--static', help='also serve this directory (local testing without nginx)')
    args = ap.parse_args()
    if args.static:
        Handler.static_dir = os.path.abspath(args.static)
        handler = lambda *a, **k: Handler(*a, directory=Handler.static_dir, **k)  # noqa: E731
    else:
        handler = Handler
    threading.Thread(target=reaper, daemon=True).start()
    print(f'akochan bridge on http://{args.host}:{args.port}  engine: {" ".join(engine_command()[0])}', flush=True)
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()


if __name__ == '__main__':
    main()
