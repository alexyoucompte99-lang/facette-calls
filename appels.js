/* ------------------------------------------------------------------
   Facette · Les appels à venir
   Onglet ajouté au tableau de bord : tous les rendez-vous posés dans
   l'agenda, jour par jour, avec tout ce qu'on sait du prospect (ses
   coordonnées, son cabinet, son score, sa place sur Google) et un
   bouton WhatsApp avec le message déjà écrit, pour confirmer l'appel
   et faire monter le taux de présence.

   Se branche sans toucher à app.js : il suffit de charger ce fichier
   après app.js et de poser la section <section id="appels"> dans
   index.html (voir INTEGRATION.md).
   ------------------------------------------------------------------ */

(function () {
  'use strict';

  /* qui appelle : c'est lui qui signe les messages */
  var QUI_APPELLE = 'Alex';
  var MARQUE = 'Facette';
  var CLE_SUIVI = 'facette-appels-suivi';   /* le suivi des relances, dans le navigateur */
  var FENETRE_MATCH_MIN = 45;               /* minutes entre l'analyse et la réservation */

  var appels = { leads: null, etudes: null, erreur: null, ouvert: {} };

  /* ------------------------------ outils ----------------------------- */

  function paris(date, options) {
    var o = Object.assign({ timeZone: 'Europe/Paris' }, options);
    return new Intl.DateTimeFormat('fr-FR', o).format(date);
  }
  function jourParis(date) {              /* « 2026-09-07 », heure de Paris */
    var p = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    return p;
  }
  function heureParis(date) {             /* « 9h00 » */
    var h = paris(date, { hour: '2-digit', minute: '2-digit' });
    return h.replace(':', 'h');
  }
  function jourLisible(date) {            /* « lundi 7 septembre » */
    return paris(date, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function majuscule(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  function dansCombien(date) {
    var diff = (date - Date.now()) / 60000;   /* en minutes */
    var abs = Math.abs(diff);
    var texte;
    if (abs < 1) texte = 'maintenant';
    else if (abs < 60) texte = Math.round(abs) + ' min';
    else if (abs < 60 * 36) {
      var h = Math.floor(abs / 60), m = Math.round(abs % 60);
      texte = h + ' h' + (m ? ' ' + (m < 10 ? '0' : '') + m : '');
    } else texte = Math.round(abs / 1440) + ' j';
    if (texte === 'maintenant') return texte;
    return diff > 0 ? 'dans ' + texte : 'il y a ' + texte;
  }

  function sansAccents(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  /* le numéro tel qu'il faut pour wa.me : que des chiffres, indicatif inclus.
     Les formulaires renvoient parfois « +33 33620372157 » (indicatif tapé
     deux fois) : on le répare. */
  function numeroWhatsApp(tel) {
    var d = String(tel || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('00') === 0) d = d.slice(2);
    if (/^3333\d{9}$/.test(d)) d = d.slice(2);           /* +33 33 6… → 33 6… */
    if (/^0\d{9}$/.test(d)) d = '33' + d.slice(1);        /* 06… → 33 6… */
    return d;
  }
  function numeroLisible(tel) {
    var d = numeroWhatsApp(tel);
    if (/^33\d{9}$/.test(d)) {
      var n = '0' + d.slice(2);
      return n.replace(/(\d{2})(?=\d)/g, '$1 ');
    }
    if (/^32\d{8,9}$/.test(d)) return '+32 ' + d.slice(2).replace(/(\d{2})(?=\d)/g, '$1 ');
    return tel || '';
  }

  /* « Dr Bardin » à partir de « Theo Bardin » ; « Dr Denis Le Seve » etc. */
  function nomFamille(nom) {
    var mots = String(nom || '').trim().split(/\s+/).filter(function (m) {
      return m && !/^(dr\.?|docteur|m\.|mme|mr)$/i.test(m);
    });
    if (!mots.length) return '';
    if (mots.length === 1) return majuscule(mots[0].toLowerCase());
    /* les gens écrivent souvent leur nom en capitales : « Thomas DÉNIS LE SEVE » */
    var caps = mots.filter(function (m) { return m.length >= 2 && m === m.toUpperCase() && m !== m.toLowerCase(); });
    var choisis;
    if (caps.length && caps.length < mots.length) choisis = caps;
    else {
      /* sinon le dernier mot, en gardant la particule : « Le Seve », « De Bruyne » */
      var i = mots.length - 1;
      while (i > 1 && /^(le|la|les|de|du|des|el|van|von|di|da)$/i.test(mots[i - 1])) i--;
      choisis = mots.slice(i);
    }
    return choisis.map(function (m) { return m.toLowerCase().split('-').map(majuscule).join('-'); }).join(' ');
  }


  /* ---------------------- rattacher l'analyse au prospect ------------ */

  function etudePour(lead, etudes) {
    var quandLead = new Date(lead.quand).getTime();
    if (isNaN(quandLead) || !etudes || !etudes.length) return null;

    var famille = sansAccents(nomFamille(lead.nom));
    var tokens = sansAccents(lead.nom).split(/[^a-z]+/).filter(function (t) { return t.length >= 3; });

    var meilleure = null, meilleurScore = -1;
    etudes.forEach(function (e) {
      if (e.demo) return;
      var t = new Date(e.quand).getTime();
      if (isNaN(t)) return;
      var ecart = Math.abs(t - quandLead) / 60000;
      var cabinet = sansAccents(e.cabinet);
      var parNom = famille && famille.length >= 3 && cabinet.indexOf(famille) >= 0;
      if (!parNom) parNom = tokens.some(function (tk) { return tk.length >= 4 && cabinet.indexOf(tk) >= 0; });

      var score = -1;
      if (parNom && ecart <= 60 * 24 * 3) score = 1000 - ecart;            /* le nom d'abord */
      else if (ecart <= FENETRE_MATCH_MIN) score = 100 - ecart + (e.pub && e.pub === lead.pub ? 20 : 0);
      if (score > meilleurScore) { meilleurScore = score; meilleure = e; }
    });
    return meilleure ? Object.assign({ par_nom: meilleurScore >= 900 }, meilleure) : null;
  }

  /* ------------------------------ les messages ----------------------- */

  /* un nom de fiche Google à rallonge n'a rien à faire dans un message :
     au-delà de 45 caractères on dit « votre cabinet à Nancy » */
  function cabinetCourt(e) {
    if (!e || !e.cabinet) return 'votre cabinet';
    var nom = String(e.cabinet).trim();
    if (nom.length <= 45) return nom;
    return 'votre cabinet' + (e.ville ? ' à ' + e.ville : '');
  }

  function contexte(a) {
    var e = a.etude;
    var d = a.debut;
    var jour = jourParis(d) === jourParis(new Date()) ? 'aujourd’hui' :
      jourParis(d) === jourParis(new Date(Date.now() + 86400000)) ? 'demain' : jourLisible(d);
    return {
      nom: nomFamille(a.lead.nom) || 'Docteur',
      jour: jour,
      heure: heureParis(d),
      cabinet: cabinetCourt(e),
      ville: e && e.ville ? e.ville : 'votre ville',
      score: e && isFinite(e.global) ? e.global : null,
      position: e && e.position ? e.position : null,
      corrections: e && e.corrections ? e.corrections : null,
      qui: QUI_APPELLE,
      marque: MARQUE
    };
  }

  var MESSAGES = [
    {
      cle: 'confirmer', nom: 'Confirmer le créneau', quand: 'juste après la réservation, ou la veille',
      texte: function (c) {
        var constat = '';
        if (c.score !== null) {
          constat = 'J’ai regardé votre fiche : ' + c.score + '/100' +
            (c.position ? ', ' + c.position + 'ᵉ sur « dentiste ' + c.ville + ' »' : '') + '. ';
          if (c.corrections) constat += 'J’ai déjà repéré ' + c.corrections + ' corrections concrètes, je vous les montre pendant l’appel. ';
        }
        return 'Bonjour Dr ' + c.nom + ', ' + c.qui + ' de ' + c.marque + '. ' +
          'J’ai bien votre créneau ' + c.jour + ' à ' + c.heure + ' pour ' + c.cabinet + '. ' +
          constat +
          'On ne travaille qu’avec un seul cabinet par ville, je bloque ' + c.ville + ' pour vous jusqu’à notre appel. ' +
          'Vous me confirmez par un simple « ok » ?';
      }
    },
    {
      cle: 'question', nom: 'Poser une question', quand: 'la veille ou le matin, pour l’engager',
      texte: function (c) {
        return 'Dr ' + c.nom + ', une question rapide pour préparer notre appel ' + c.jour + ' à ' + c.heure + ' : ' +
          'aujourd’hui, quand un patient tape « dentiste ' + c.ville + ' » sur Google, il tombe sur qui ? ' +
          (c.position ? 'Vous, vous êtes ' + c.position + 'ᵉ. ' : '') +
          'Je vous montre pendant l’appel qui vous prend ces patients et comment repasser devant. ' +
          'Dernière chose : votre priorité, c’est plus de nouveaux patients, ou des patients mieux ciblés (implants, facettes, esthétique) ?';
      }
    },
    {
      cle: 'rappel', nom: 'Rappel 1 h avant', quand: 'une heure avant l’appel',
      texte: function (c) {
        return 'Dr ' + c.nom + ', on se parle dans 1 h, à ' + c.heure + '. ' +
          'J’ai l’analyse de ' + c.cabinet + ' sous les yeux' + (c.score !== null ? ' (' + c.score + '/100)' : '') + '. ' +
          'Je vous appelle sur ce numéro. Si le créneau ne tient plus, dites-le moi maintenant : ' +
          'je le libère pour un autre cabinet et on en recale un.';
      }
    },
    {
      cle: 'absent', nom: 'Il n’a pas répondu', quand: 'juste après un appel manqué',
      texte: function (c) {
        return 'Dr ' + c.nom + ', je vous ai appelé à ' + c.heure + ', sans réponse. Ça arrive. ' +
          'J’ai gardé l’analyse de ' + c.cabinet + (c.score !== null ? ' (' + c.score + '/100' + (c.corrections ? ', ' + c.corrections + ' corrections à faire' : '') + ')' : '') + '. ' +
          'Je garde ' + c.ville + ' de côté jusqu’à demain soir, ensuite je propose la place au cabinet suivant. ' +
          'Quel créneau vous arrange : ce soir 18h ou demain matin 9h ?';
      }
    }
  ];

  function messageDe(cle, a) {
    var m = MESSAGES.filter(function (x) { return x.cle === cle; })[0] || MESSAGES[0];
    return m.texte(contexte(a));
  }

  /* la relance qui tombe sous le sens maintenant, selon l'heure de l'appel */
  function messageConseille(a) {
    var minutes = (a.debut - Date.now()) / 60000;
    if (minutes < -5) return 'absent';
    if (minutes <= 90) return 'rappel';
    if (minutes <= 60 * 26 && !a.suivi.confirmer) return 'confirmer';
    if (minutes <= 60 * 26) return 'question';
    return 'confirmer';
  }

  /* ------------------------------ le suivi --------------------------- */

  function lireSuivi() {
    try { return JSON.parse(window.localStorage.getItem(CLE_SUIVI) || '{}'); } catch (e) { return {}; }
  }
  function ecrireSuivi(s) {
    try { window.localStorage.setItem(CLE_SUIVI, JSON.stringify(s)); } catch (e) { /* tant pis */ }
  }
  function marquer(id, cle, valeur) {
    var s = lireSuivi();
    s[id] = s[id] || {};
    if (valeur) s[id][cle] = new Date().toISOString(); else delete s[id][cle];
    ecrireSuivi(s);
  }

  /* ------------------------------ lecture ---------------------------- */

  function chargerAppels() {
    /* page autonome : les données viennent d'un fichier JSON relevé par le robot */
    if (window.APPELS_SOURCE) {
      fetch(window.APPELS_SOURCE + (window.APPELS_SOURCE.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('fichier des rendez-vous introuvable (' + r.status + ')'); return r.json(); })
        .then(function (j) {
          appels.leads = j.leads || []; appels.etudes = j.etudes || []; appels.erreur = null;
          appels.releve = j.genere_le || null;
          rendreAppels();
        })
        .catch(function (e) { appels.erreur = e.message; rendreAppels(); });
      return;
    }
    var periode = 'depuis=' + encodeURIComponent(PREMIER_JOUR) + '&jusqua=' + encodeURIComponent(aujourdhui());
    var pLeads = lireApi('/api/leads?' + periode).then(function (r) {
      if (!r.ok || r.corps.erreur) throw new Error(r.corps.erreur || 'réponse inattendue');
      return r.corps.leads || [];
    });
    var pFunnel = lireApi('/api/funnel?' + periode + '&tests=1').then(function (r) {
      if (!r.ok || r.corps.erreur) throw new Error(r.corps.erreur || 'réponse inattendue');
      return r.corps.etudes || [];
    }).catch(function () { return []; });

    Promise.all([pLeads, pFunnel]).then(function (res) {
      appels.leads = res[0]; appels.etudes = res[1]; appels.erreur = null;
      rendreAppels();
    }).catch(function (e) {
      if (e.message === 'connexion') return;
      appels.erreur = e.message || 'La liste des appels n’a pas pu être lue.';
      rendreAppels();
    });
  }

  /* ------------------------------ rendu ------------------------------ */

  function listeAppels() {
    var suivi = lireSuivi();
    var debutJour = new Date(); debutJour.setHours(0, 0, 0, 0);
    var res = [];
    (appels.leads || []).forEach(function (l) {
      if (l.rdv !== 'confirme' || !l.rdv_debut) return;
      if (l.test && !(window.etat && etat.tests)) return;
      var d = new Date(l.rdv_debut);
      if (isNaN(d) || d < debutJour) return;
      res.push({ lead: l, debut: d, etude: etudePour(l, appels.etudes), suivi: suivi[l.id] || {} });
    });
    res.sort(function (a, b) { return a.debut - b.debut; });
    return res;
  }

  function chipScore(etiquette, v, avecCouleur) {
    var cl = avecCouleur && isFinite(v) ? ' ' + classeScore(v) : '';
    return '<span class="appel-chip' + cl + '"><i>' + etiquette + '</i>' + (isFinite(v) ? nombre(v) : '—') + '</span>';
  }

  function carteAppel(a) {
    var l = a.lead, e = a.etude, id = html(l.id);
    var passe = a.debut.getTime() < Date.now() - 5 * 60000;
    var tel = numeroWhatsApp(l.telephone);
    var conseil = messageConseille(a);
    var ouvert = appels.ouvert[l.id] || conseil;
    var texte = messageDe(ouvert, a);
    var reserve = new Date(l.quand);
    var delai = Math.round((a.debut - reserve) / 3600000);

    var s = '<article class="appel' + (passe ? ' appel-passe' : '') + (a.suivi.confirme ? ' appel-confirme' : '') + '" data-id="' + id + '">';

    /* l'heure */
    s += '<div class="appel-heure"><b>' + heureParis(a.debut) + '</b><span>' + (passe ? 'passé · ' : '') + dansCombien(a.debut) + '</span>';
    if (a.suivi.confirme) s += '<em class="appel-ok">confirmé ✓</em>';
    s += '</div>';

    /* le prospect */
    s += '<div class="appel-corps">';
    s += '<p class="appel-nom">' + html(l.nom || '(sans nom)') + (l.test ? ' <span class="badge-test">test équipe</span>' : '') + '</p>';
    s += '<p class="appel-contact">';
    if (tel) s += '<a class="lien-tel" href="tel:+' + tel + '">' + html(numeroLisible(l.telephone)) + '</a>';
    if (l.email) s += (tel ? ' · ' : '') + '<a class="lien-tel" href="mailto:' + html(l.email) + '">' + html(l.email) + '</a>';
    s += '</p>';

    if (e) {
      s += '<div class="appel-cabinet">';
      s += '<p class="appel-cabinet-nom">' + html(e.cabinet || 'Cabinet non transmis') + (e.ville ? ' <span>· ' + html(e.ville) + '</span>' : '') +
        (!e.par_nom ? ' <span class="appel-approx" title="Rattaché par l’heure de l’analyse, pas par le nom : à vérifier">rattaché par l’heure</span>' : '') + '</p>';
      s += '<p class="appel-chips">' + chipScore('Score', e.global, true) + chipScore('Google', e.seo) + chipScore('IA', e.geo) +
        '<span class="appel-chip"><i>Place</i>' + (e.position ? e.position + 'ᵉ' : '—') + '</span>' +
        '<span class="appel-chip"><i>Corrections</i>' + (isFinite(e.corrections) ? e.corrections : '—') + '</span></p>';
      if (e.telephone) s += '<p class="appel-sous">Ligne du cabinet (fiche Google) : <a class="lien-tel" href="tel:' + html(String(e.telephone).replace(/\s+/g, '')) + '">' + html(e.telephone) + '</a></p>';
      s += '</div>';
    } else {
      s += '<p class="appel-sous appel-sans">Aucune analyse rattachée : il a réservé sans faire le test, ou trop loin de l’analyse. À préparer à la main.</p>';
    }

    s += '<p class="appel-sous">Réservé le ' + paris(reserve, { day: '2-digit', month: '2-digit' }) + ' à ' + heureParis(reserve) +
      (delai > 0 ? ' · ' + (delai >= 48 ? Math.round(delai / 24) + ' j' : delai + ' h') + ' avant l’appel' : '') +
      (l.pub ? ' · pub <code>' + html(l.pub) + '</code>' : '') +
      (l.qualite ? ' · pixel : ' + html(nomQualite(l.qualite)) : '') + '</p>';
    s += '</div>';

    /* les relances */
    s += '<div class="appel-actions">';
    s += '<div class="appel-choix">';
    MESSAGES.forEach(function (m) {
      var fait = a.suivi[m.cle];
      s += '<button type="button" class="appel-onglet' + (ouvert === m.cle ? ' actif' : '') + (fait ? ' fait' : '') +
        '" data-message="' + m.cle + '" title="' + html(m.quand) + '">' + m.nom + (fait ? ' ✓' : '') +
        (conseil === m.cle && !fait ? '<i>conseillé</i>' : '') + '</button>';
    });
    s += '</div>';
    s += '<textarea class="appel-texte" rows="5" spellcheck="false">' + html(texte) + '</textarea>';
    s += '<div class="appel-boutons">';
    if (tel) s += '<a class="appel-wa" target="_blank" rel="noopener" href="https://wa.me/' + tel + '?text=' + encodeURIComponent(texte) + '" data-wa="' + tel + '">Ouvrir WhatsApp</a>';
    else s += '<span class="appel-sous">pas de numéro</span>';
    s += '<button type="button" class="appel-copier">Copier</button>';
    s += '<label class="appel-case"><input type="checkbox" data-suivi="' + ouvert + '"' + (a.suivi[ouvert] ? ' checked' : '') + '> message envoyé</label>';
    s += '<label class="appel-case appel-case-ok"><input type="checkbox" data-suivi="confirme"' + (a.suivi.confirme ? ' checked' : '') + '> il a confirmé</label>';
    s += '</div></div>';

    s += '</article>';
    return s;
  }

  function rendreAppels() {
    var cible = document.getElementById('liste-appels');
    var compteur = document.getElementById('compteur-appels');
    if (!cible) return;

    if (appels.erreur) {
      cible.innerHTML = '<p class="alerte">' + html(appels.erreur) + '</p>';
      if (compteur) compteur.hidden = true;
      return;
    }
    if (!appels.leads) {
      cible.innerHTML = '<p class="appel-vide">Lecture des rendez-vous…</p>';
      return;
    }
    var liste = listeAppels();
    if (compteur) {
      var aVenir = liste.filter(function (a) { return a.debut > Date.now(); }).length;
      var confirmes = liste.filter(function (a) { return a.suivi.confirme; }).length;
      compteur.hidden = false;
      compteur.textContent = aVenir + ' à venir · ' + confirmes + ' confirmé' + (confirmes > 1 ? 's' : '') + ' par message';
      var releve = document.getElementById('releve-appels');
      if (releve && appels.releve) {
        var dr = new Date(appels.releve);
        releve.textContent = isNaN(dr) ? '' : 'Relevé le ' + paris(dr, { day: '2-digit', month: '2-digit' }) + ' à ' + heureParis(dr) + ' · mise à jour automatique toutes les 15 min';
      }
      compteur.classList.toggle('tout-fait', aVenir > 0 && confirmes === aVenir);
    }
    if (!liste.length) {
      cible.innerHTML = '<p class="appel-vide">Aucun rendez-vous à venir dans l’agenda.</p>';
      return;
    }

    var s = '', jourCourant = null;
    var aujourdhuiP = jourParis(new Date()), demainP = jourParis(new Date(Date.now() + 86400000));
    liste.forEach(function (a) {
      var j = jourParis(a.debut);
      if (j !== jourCourant) {
        if (jourCourant !== null) s += '</div>';
        jourCourant = j;
        var n = liste.filter(function (x) { return jourParis(x.debut) === j; }).length;
        var pref = j === aujourdhuiP ? 'Aujourd’hui' : j === demainP ? 'Demain' : '';
        s += '<h3 class="appel-jour">' + (pref ? pref + ' <span>· ' : '<span>') + majuscule(jourLisible(a.debut)) + '</span>' +
          '<em>' + n + ' appel' + (n > 1 ? 's' : '') + '</em></h3><div class="appel-grille">';
      }
      s += carteAppel(a);
    });
    s += '</div>';
    cible.innerHTML = s;
  }

  /* ------------------------------ interactions ----------------------- */

  function appelDepuis(el) {
    var art = el.closest('article.appel');
    if (!art) return null;
    var id = art.getAttribute('data-id');
    var liste = listeAppels();
    for (var i = 0; i < liste.length; i++) if (liste[i].lead.id === id) return liste[i];
    return null;
  }

  document.addEventListener('click', function (ev) {
    var onglet = ev.target.closest('.appel-onglet');
    if (onglet) {
      var a = appelDepuis(onglet);
      if (!a) return;
      appels.ouvert[a.lead.id] = onglet.dataset.message;
      rendreAppels();
      return;
    }
    var copier = ev.target.closest('.appel-copier');
    if (copier) {
      var art = copier.closest('article.appel');
      var texte = art.querySelector('.appel-texte').value;
      var fini = function () { copier.textContent = 'Copié ✓'; window.setTimeout(function () { copier.textContent = 'Copier'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texte).then(fini, fini);
      else { art.querySelector('.appel-texte').select(); document.execCommand('copy'); fini(); }
    }
  });

  /* le texte modifié à la main part tel quel dans WhatsApp */
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('appel-texte')) return;
    var art = ev.target.closest('article.appel');
    var wa = art.querySelector('.appel-wa');
    if (wa) wa.href = 'https://wa.me/' + wa.dataset.wa + '?text=' + encodeURIComponent(ev.target.value);
  });

  document.addEventListener('change', function (ev) {
    var case_ = ev.target;
    if (!case_.dataset || !case_.dataset.suivi) return;
    var art = case_.closest('article.appel');
    if (!art) return;
    marquer(art.getAttribute('data-id'), case_.dataset.suivi, case_.checked);
    rendreAppels();
  });

  /* ------------------------------ branchement ------------------------ */

  /* on se glisse derrière charger() : à chaque lecture des chiffres, la
     liste des appels est relue aussi, sur toute la période (les rendez-vous
     ne dépendent pas des dates choisies en haut). */
  if (typeof charger === 'function') {
    var chargerOrigine = charger;
    charger = function () { chargerOrigine.apply(this, arguments); chargerAppels(); };
  }
  /* la case « inclure nos tests » change la liste */
  var chipTests = document.getElementById('chip-tests');
  if (chipTests) chipTests.addEventListener('click', function () { window.setTimeout(rendreAppels, 0); });

  /* « dans 2 h 15 » vieillit : on rafraîchit la minute */
  window.setInterval(function () { if (appels.leads) rendreAppels(); }, 60000);

  /* si le tableau est déjà affiché quand ce fichier arrive (injection), on lit tout de suite */
  var tableau = document.getElementById('tableau');
  if (tableau && !tableau.hidden) chargerAppels();

  window.chargerAppels = chargerAppels;
  window.rendreAppels = rendreAppels;
})();
