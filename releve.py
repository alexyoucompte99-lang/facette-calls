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
import hashlib
import http.cookiejar
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

BASE = 'https://dashboard-facette.vercel.app'
LP = 'https://cadence-dentistes.vercel.app'      # l'API publique du test de référencement
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


def dechiffrer(paquet, mot_de_passe):
    b = lambda t: base64.b64decode(paquet[t])
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=b('sel'), iterations=paquet['iterations'])
    cle = kdf.derive(mot_de_passe.encode())
    return json.loads(AESGCM(cle).decrypt(b('iv'), b('data'), None).decode())


def lp(chemin):
    req = urllib.request.Request(LP + chemin, headers={'User-Agent': 'facette-calls/1.0'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def sans_accents(t):
    return ''.join(c for c in unicodedata.normalize('NFD', str(t or '')) if unicodedata.category(c) != 'Mn').lower()


def quand(iso):
    try:
        return dt.datetime.fromisoformat(str(iso).replace('Z', '+00:00'))
    except ValueError:
        return None


def detail_cabinet(e):
    """L'analyse complète du cabinet : note Google, site, concurrents, corrections en clair."""
    q = urllib.parse.quote((e.get('cabinet') or '') + ' ' + (e.get('ville') or ''))
    sugg = lp('/api/cherche?q=' + q).get('suggestions') or []
    if not sugg:
        return None
    a = lp('/api/analyse?q=' + q + '&id=' + urllib.parse.quote(sugg[0]['id']))
    ent = a.get('entreprise') or {}
    return {
        'releve': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'place_id': ent.get('place_id') or sugg[0]['id'],
        'nom': ent.get('nom'), 'note': ent.get('note'), 'avis': ent.get('avis'),
        'site': ent.get('site'), 'telephone': ent.get('telephone'),
        'position': a.get('position'), 'total': a.get('total'),
        'global': a.get('scoreGlobal'), 'seo': a.get('scoreSeo'), 'geo': a.get('scoreGeo'),
        'concurrents': [{'nom': c.get('nom'), 'note': c.get('note'), 'avis': c.get('avis')} for c in (a.get('concurrents') or [])[:5]],
        'corrections': [{'niveau': c.get('niveau'), 'groupe': c.get('groupe'), 'titre': c.get('titre'), 'texte': c.get('texte')} for c in (a.get('corrections') or [])],
    }


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
# les détails (corrections en clair, concurrents…) pour les cabinets des appels à venir.
# On repart de ceux déjà relevés (fichier précédent déchiffré) et on rafraîchit après 24 h.
anciens = {}
if os.path.exists(SORTIE):
    try:
        with open(SORTIE, encoding='utf-8') as f:
            anciens = dechiffrer(json.load(f), code).get('details') or {}
    except Exception as e:  # noqa: BLE001
        print('détails précédents illisibles :', e)

maintenant = dt.datetime.now(dt.timezone.utc)
a_venir = [l for l in contenu['leads'] if l.get('rdv') == 'confirme' and quand(l.get('rdv_debut')) and quand(l['rdv_debut']) >= maintenant - dt.timedelta(days=1)]
candidats = {}
for l in a_venir:
    ql = quand(l.get('quand'))
    tokens = [t for t in re.split(r'[^a-z]+', sans_accents(l.get('nom'))) if len(t) >= 4]
    for e in contenu['etudes']:
        qe = quand(e.get('quand'))
        if not ql or not qe:
            continue
        ecart = abs((qe - ql).total_seconds()) / 60
        cab = sans_accents(e.get('cabinet'))
        par_nom = any(t in cab for t in tokens)
        if (par_nom and ecart <= 3 * 24 * 60) or ecart <= 45:
            candidats[(e.get('cabinet') or '') + '|' + (e.get('ville') or '')] = e

details = {}
for cle_cab, e in candidats.items():
    ancien = anciens.get(cle_cab)
    if ancien and quand(ancien.get('releve')) and maintenant - quand(ancien['releve']) < dt.timedelta(hours=24):
        details[cle_cab] = ancien
        continue
    try:
        d = detail_cabinet(e)
        if d:
            details[cle_cab] = d
        elif ancien:
            details[cle_cab] = ancien
    except Exception as ex:  # noqa: BLE001
        print('détail impossible pour', cle_cab, ':', ex)
        if ancien:
            details[cle_cab] = ancien
contenu['details'] = details
print('%d cabinets détaillés (%d relus)' % (len(details), len(candidats)))

os.makedirs(os.path.dirname(SORTIE), exist_ok=True)

# l'empreinte du contenu (sans l'heure) : si rien n'a bougé, on ne réécrit pas
# le fichier, sinon le chiffrement (sel aléatoire) ferait un commit toutes les 15 min
empreinte = hashlib.sha256(json.dumps({'leads': contenu['leads'], 'etudes': contenu['etudes'], 'details': contenu['details']}, sort_keys=True).encode()).hexdigest()
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
