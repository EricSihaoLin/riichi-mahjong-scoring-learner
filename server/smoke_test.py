#!/usr/bin/env python3
"""Checks the akochan bridge end to end: plays a few events of a hand and prints akochan's answers and timing.

    python3 server/smoke_test.py            # bridge on 127.0.0.1:8091
    python3 server/smoke_test.py --raw      # also print the raw JSON akochan returned
"""
import json
import os
import sys
import time
import urllib.request

BASE = os.environ.get('BRIDGE', 'http://127.0.0.1:8091') + '/api/akochan/'
HIDDEN = ['?'] * 13
EVENTS = [
    {'type': 'start_game', 'names': ['You', 'Shimocha', 'Toimen', 'Kamicha']},
    {'type': 'start_kyoku', 'bakaze': 'E', 'kyoku': 1, 'honba': 0, 'kyotaku': 0, 'oya': 0, 'dora_marker': '3s',
     'scores': [25000, 25000, 25000, 25000],
     'tehais': [['1m', '2m', '3m', '5mr', '6m', '4p', '4p', '6p', '7s', '8s', 'E', 'P', 'C'], HIDDEN, HIDDEN, HIDDEN]},
    {'type': 'tsumo', 'actor': 0, 'pai': '9s'},           # review 0: our discard
]
AFTER = [
    {'type': 'dahai', 'actor': 0, 'pai': 'C', 'tsumogiri': False},
    {'type': 'tsumo', 'actor': 1, 'pai': '?'},
    {'type': 'dahai', 'actor': 1, 'pai': '4p', 'tsumogiri': False},  # review 1: pon 4p or skip
]


def call(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def show(n, sid, raw):
    t0 = time.time()
    while True:
        r = call(f'result?id={sid}&n={n}&wait=20')
        if r['status'] != 'pending':
            break
    print(f'\nreview #{n}: {r["status"]} after {time.time() - t0:.1f}s (engine time {r.get("seconds")}s)')
    if r['status'] != 'ready':
        print('  ', r)
        return False
    for a in r['actions'][:5]:
        moves = ' + '.join(m.get('type') + (' ' + m['pai'] if 'pai' in m else '') + (' ' + ','.join(m['consumed']) if 'consumed' in m else '') for m in a['moves'])
        print(f"   {a['review'].get('pt_exp_total'):>9.3f}  {moves}")
    if raw:
        print(json.dumps(r['actions'][:3], indent=1)[:3000])
    return True


def main():
    raw = '--raw' in sys.argv
    print('health:', call('health'))
    sid = call('session', {})['id']
    call('events', {'id': sid, 'start': 0, 'events': EVENTS})
    ok = show(0, sid, raw)
    call('events', {'id': sid, 'start': len(EVENTS), 'events': AFTER})
    ok = show(1, sid, raw) and ok
    call('close', {'id': sid})
    print('\nOK – akochan is answering.' if ok else '\nFAILED – see the messages above.')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
