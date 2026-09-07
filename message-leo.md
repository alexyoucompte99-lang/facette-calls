Salut Léo,

J'ai fait un nouvel onglet pour le dashboard Facette : « Les appels à venir ». Le but : voir tous les RDV posés dans Créno, jour par jour, avec tout ce qu'on sait du dentiste, et relancer en un clic sur WhatsApp pour faire monter le show-up.

Ce qu'il affiche pour chaque RDV :
- heure (Paris), compte à rebours, nom, téléphone, e-mail
- son cabinet, sa ville, score global / Google / IA, sa place sur Google, nombre de corrections, la ligne du cabinet (rattaché depuis « Les analyses réalisées » par le nom, sinon par l'heure avec un badge « rattaché par l'heure »)
- date de réservation, pub d'origine, qualification pixel

Et pour relancer :
- 4 messages WhatsApp déjà écrits avec ces infos (confirmer le créneau, poser une question pour l'engager, rappel 1 h avant, il n'a pas répondu), le bon est marqué « conseillé » selon l'heure
- texte modifiable, bouton « Ouvrir WhatsApp » et « Copier »
- cases « message envoyé » / « il a confirmé » (stockées dans le navigateur, pas en base)

Techniquement : 3 fichiers, aucune modification de app.js. Ça lit /api/leads et /api/funnel avec la session déjà ouverte, rien à ajouter côté API ni SQL.

À faire dans le repo (10 min) :
1. Copier appels.js et appels.css à côté de app.js
2. Dans index.html, dans le <head> : <link rel="stylesheet" href="appels.css">
3. Coller le contenu de section.html juste après <section class="grille-kpi" id="kpi-argent" ...></section>
4. En bas, après <script src="app.js"></script> : <script src="appels.js"></script>
5. Déployer

Les fichiers : https://github.com/alexyoucompte99-lang/facette-calls (aussi en ligne sur https://alexyoucompte99-lang.github.io/facette-calls/). La notice complète est dans INTEGRATION.md.

Réglages en haut de appels.js si besoin : QUI_APPELLE (signature des messages), MARQUE, FENETRE_MATCH_MIN (fenêtre analyse ↔ réservation, 45 min).

Plus tard, si on veut partager le suivi coché entre nous deux : 2 colonnes sur la table des leads + une route PATCH sur /api/leads. Je te dis quand ça devient utile.

Alex
