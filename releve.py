#!/usr/bin/env python3
"""Relevé des rendez-vous du dashboard Facette → data/appels.json.

Se connecte avec le code d'accès (secret FACETTE_CODE), lit /api/leads et
/api/funnel sur toute la période, et n'écrit que ce dont la page a besoin.
"""
import datetime as dt
import http.cookiejar
import json
import os
import sys
import urllib.request

BASE = 'https://dashboard-facette.vercel.app'
PREMIER_JOUR = '2026-08-30'
SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'appels.json')

code = os.environ.get('FACETTE_CODE', '').strip()
if not code:
    sys.exit('FACETTE_CODE manquant')

jar = http.cookiejar.CookieJar()
ouvre = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
ouvre.addheaders = [('User-Agent', 'facette-calls/1.0')]


def appel(chemin, corps=None):
    req = urllib.request.Request(BASE + chemin, method='POST' if corps is not None else 'GET')
    data = None
    if corps is not None:
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(corps).encode()
    with ouvre.open(req, data, timeout=60) as r:
        return json.loads(r.read().decode())


entree = appel('/api/entree', {'code': code})
if not entree.get('qui') and not entree.get('connecte'):
    sys.exit('connexion refusée : %s' % entree)

aujourdhui = dt.date.today().isoformat()
periode = 'depuis=%s&jusqua=%s' % (PREMIER_JOUR, aujourdhui)
leads = appel('/api/leads?' + periode).get('leads', [])
etudes = appel('/api/funnel?' + periode + '&tests=1').get('etudes', [])

CHAMPS_LEAD = ['id', 'quand', 'nom', 'telephone', 'email', 'pub', 'test', 'rdv', 'rdv_debut', 'qualite']
CHAMPS_ETUDE = ['quand', 'cabinet', 'ville', 'telephone', 'global', 'seo', 'geo', 'position', 'corrections', 'demo', 'test', 'pub']

sortie = {
    'genere_le': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
    'leads': [{k: l.get(k) for k in CHAMPS_LEAD} for l in leads if l.get('rdv_debut')],
    'etudes': [{k: e.get(k) for k in CHAMPS_ETUDE} for e in etudes if not e.get('demo')],
}
os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
with open(SORTIE, 'w', encoding='utf-8') as f:
    json.dump(sortie, f, ensure_ascii=False, indent=1)
print('%d rendez-vous, %d analyses' % (len(sortie['leads']), len(sortie['etudes'])))
