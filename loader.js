/* Chargeur « bookmarklet » : ajoute l'onglet « Les appels à venir » sur
   https://dashboard-facette.vercel.app sans toucher au site de Léo.
   À utiliser en attendant que les fichiers soient dans le dépôt. */
(function () {
  var base = 'https://alexyoucompte99-lang.github.io/facette-calls/';
  var v = '?v=' + Date.now();
  if (document.getElementById('appels')) { if (window.chargerAppels) window.chargerAppels(); return; }
  Promise.all([
    fetch(base + 'appels.css' + v).then(function (r) { return r.text(); }),
    fetch(base + 'section.html' + v).then(function (r) { return r.text(); })
  ]).then(function (res) {
    var st = document.createElement('style'); st.id = 'appels-css'; st.textContent = res[0]; document.head.appendChild(st);
    var kpi = document.getElementById('kpi-argent');
    var d = document.createElement('div'); d.innerHTML = res[1];
    kpi.parentNode.insertBefore(d.querySelector('section'), kpi.nextSibling);
    var s = document.createElement('script'); s.src = base + 'appels.js' + v; document.body.appendChild(s);
  }).catch(function (e) { window.alert('Impossible de charger l’onglet : ' + e.message); });
})();
