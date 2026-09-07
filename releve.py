#!/usr/bin/env python3
"""Relevé des rendez-vous du dashboard Facette → data/appels.enc (chiffré).

Se connecte avec le code d'accès (secret FACETTE_CODE), lit /api/leads et
/api/funnel sur toute la période, garde le strict nécessaire et chiffre le
tout avec ce même code (AES-GCM, clé dérivée par PBKDF2) : le dépôt est
public, les coordonnées des dentistes ne doivent jamais y être en clair.
La page calls.html demande le code une fois et déchiffre dans le navigateur.
"""
import base64
import datetime as dt
import http.cookiejar
import json
import os
import sys
import urllib.request

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

BASE = 'https://dashboard-facette.vercel.app'
PREMIER_JOUR = '2026-08-30'
ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, 'data', 'appels.enc')
ITERATIONS = 200000

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


def chiffrer(texte, mot_de_passe):
    sel = os.urandom(16)
    iv = os.urandom(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sel, iterations=ITERATIONS)
    cle = kdf.derive(mot_de_passe.encode())
    chiffre = AESGCM(cle).encrypt(iv, texte.encode(), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {'v': 1, 'kdf': 'PBKDF2-SHA256', 'iterations': ITERATIONS, 'sel': b64(sel), 'iv': b64(iv), 'data': b64(chiffre)}


entree = appel('/api/entree', {'code': code})
if not entree.get('qui') and not entree.get('connecte'):
    sys.exit('connexion refusée : %s' % entree)

aujourdhui = dt.date.today().isoformat()
periode = 'depuis=%s&jusqua=%s' % (PREMIER_JOUR, aujourdhui)
leads = appel('/api/leads?' + periode).get('leads', [])
etudes = appel('/api/funnel?' + periode + '&tests=1').get('etudes', [])

CHAMPS_LEAD = ['id', 'quand', 'nom', 'telephone', 'email', 'pub', 'test', 'rdv', 'rdv_debut', 'qualite']
CHAMPS_ETUDE = ['quand', 'cabinet', 'ville', 'telephone', 'global', 'seo', 'geo', 'position', 'corrections', 'demo', 'test', 'pub']

contenu = {
    'genere_le': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
    'leads': [{k: l.get(k) for k in CHAMPS_LEAD} for l in leads if l.get('rdv_debut')],
    'etudes': [{k: e.get(k) for k in CHAMPS_ETUDE} for e in etudes if not e.get('demo')],
}
os.makedirs(os.path.dirname(SORTIE), exist_ok=True)

# l'empreinte du contenu (sans l'heure) : si rien n'a bougé, on ne réécrit pas
# le fichier, sinon le chiffrement (sel aléatoire) ferait un commit toutes les 15 min
import hashlib
empreinte = hashlib.sha256(json.dumps({'leads': contenu['leads'], 'etudes': contenu['etudes']}, sort_keys=True).encode()).hexdigest()
if os.path.exists(SORTIE):
    try:
        with open(SORTIE, encoding='utf-8') as f:
            if json.load(f).get('empreinte') == empreinte:
                print('inchangé : %d rendez-vous, %d analyses' % (len(contenu['leads']), len(contenu['etudes'])))
                sys.exit(0)
    except (ValueError, OSError):
        pass

paquet = chiffrer(json.dumps(contenu, ensure_ascii=False), code)
paquet['genere_le'] = contenu['genere_le']          # en clair : juste l'heure du relevé
paquet['empreinte'] = empreinte
with open(SORTIE, 'w', encoding='utf-8') as f:
    json.dump(paquet, f, indent=1)
print('%d rendez-vous, %d analyses, chiffrés' % (len(contenu['leads']), len(contenu['etudes'])))
