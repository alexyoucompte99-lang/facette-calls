# Onglet « Les appels à venir » pour le dashboard Facette

Trois fichiers, zéro modification de `app.js`.

## À faire dans le dépôt de dashboard-facette

1. Copier `appels.js` et `appels.css` à la racine du site (à côté de `app.js` et `styles.css`).
2. Dans `index.html` :
   - dans le `<head>`, après la feuille de style existante :
     ```html
     <link rel="stylesheet" href="appels.css">
     ```
   - juste après `<section class="grille-kpi" id="kpi-argent" ...></section>`, coller le contenu de `section.html`.
   - tout en bas, après `<script src="app.js"></script>` :
     ```html
     <script src="appels.js"></script>
     ```
3. Déployer. Rien d'autre : l'onglet lit `/api/leads` et `/api/funnel` (toute la période, tests inclus puis filtrés côté page) avec la session déjà ouverte.

## Ce que fait l'onglet

- Tous les rendez-vous `confirme` de l'agenda à partir d'aujourd'hui, groupés par jour (heure de Paris), avec le compte à rebours.
- Pour chaque prospect : nom, téléphone (lien), e-mail, cabinet + ville + score global/Google/IA + place + nombre de corrections (analyse rattachée par le nom, sinon par l'heure avec le badge « rattaché par l'heure »), ligne publique du cabinet, date de réservation, pub d'origine, qualification pixel.
- 4 messages WhatsApp prêts, personnalisés avec ces données : Confirmer le créneau, Poser une question, Rappel 1 h avant, Il n'a pas répondu. Le bon message est « conseillé » selon l'heure de l'appel. Texte modifiable avant envoi, bouton « Ouvrir WhatsApp » (wa.me) et « Copier ».
- Suivi « message envoyé » / « il a confirmé » : dans le localStorage du navigateur (pas de SQL à ajouter). Si un jour on veut le partager entre Alex et Léo, ajouter deux colonnes sur la table des leads et un `PATCH /api/leads`.
- Le numéro « +33 33620372157 » (indicatif tapé deux fois par le prospect) est réparé automatiquement pour WhatsApp.

## Réglages

En haut de `appels.js` : `QUI_APPELLE` (signature des messages), `MARQUE`, `FENETRE_MATCH_MIN` (fenêtre de rattachement analyse ↔ réservation, 45 min).

## En attendant l'intégration : le bookmarklet

Un favori dont l'adresse est le contenu de `bookmarklet.txt`. Ouvrir le dashboard, cliquer le favori : l'onglet apparaît sous les KPI. Il charge les fichiers depuis https://alexyoucompte99-lang.github.io/facette-calls/.
