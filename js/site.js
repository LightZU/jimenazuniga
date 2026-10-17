/* ==========================================================================
   Jimena Zúñiga — comportements du site (remplace webflow.js et jQuery)
   --------------------------------------------------------------------------
   1. Panneaux : ouverture au survol (ou au toucher sur mobile)
   2. Accueil : « mode blanc », taille du halo bleu, aperçus d'images
   3. Pages projet : diaporama (défilement auto, clic, glissé)
   Les classes ajoutées ici sont décrites en tête de css/style.css.
   ========================================================================== */

(function () {
  'use strict';

  var body = document.body;

  // Au chargement, le navigateur signale un « survol » de l'élément placé sous
  // une souris immobile (ex. sur « events » après un clic sur « back »). Comme
  // sur le site d'origine, on ne réagit au survol qu'une fois la souris bougée
  // ou l'écran touché.
  var pointeurActif = false;
  ['mousemove', 'mousedown', 'touchstart'].forEach(function (type) {
    document.addEventListener(type, function () { pointeurActif = true; }, { capture: true, passive: true });
  });

  function auSurvol(el, action) {
    el.addEventListener('mouseenter', function () {
      if (pointeurActif) action();
    });
  }

  /* 1. Panneaux ------------------------------------------------------------
     Un panneau ([data-panneau]) contient un libellé et un contenu.
     - survol : ouvre ; sortie : referme (classe .est-ferme)
     - clic : ouvre, ou alterne ouvert/fermé si data-panneau="bascule"
       (texte de Jimena et fiches des pages projet). Sur mobile, le toucher
       déclenche les mêmes événements que la souris. */
  document.querySelectorAll('[data-panneau]').forEach(function (panneau) {
    var bascule = panneau.getAttribute('data-panneau') === 'bascule';
    var clics = 0;
    var attenteSurvol = null;
    var attenteClic = null;

    function ouvrir() {
      panneau.classList.add('est-ouvert');
      panneau.classList.remove('est-ferme');
      if (panneau.classList.contains('panneau--jimena')) body.classList.add('jimena-ouverte');
    }

    // Ouverture différée de 10 ms (comme sur le site Webflow d'origine) : sur
    // mobile, le toucher qui ouvre la liste ne doit pas « cliquer » sur le
    // lien qui apparaît sous le doigt.
    // (un clic déjà engagé n'est pas annulé par la sortie de la souris)
    function ouvrirAuSurvol() {
      clearTimeout(attenteSurvol);
      attenteSurvol = setTimeout(ouvrir, 10);
    }

    function ouvrirAuClic() {
      clearTimeout(attenteClic);
      attenteClic = setTimeout(ouvrir, 10);
    }

    function fermer() {
      clearTimeout(attenteSurvol);
      panneau.classList.remove('est-ouvert');
      panneau.classList.add('est-ferme');
      if (panneau.classList.contains('panneau--jimena')) body.classList.remove('jimena-ouverte');
    }

    auSurvol(panneau, ouvrirAuSurvol);
    panneau.addEventListener('mouseleave', fermer);
    panneau.addEventListener('click', function (e) {
      // Les libellés sont des liens « # » : on ne change pas d'URL
      if (e.target.closest('a[href="#"]')) e.preventDefault();
      if (bascule && clics % 2 === 1) {
        clearTimeout(attenteClic);
        fermer();
      } else {
        ouvrirAuClic();
      }
      clics++;
    });
  });

  /* 2. Accueil ------------------------------------------------------------- */
  var rondBleu = document.querySelector('.rond__bleu');

  // Mode blanc : définitif dès le premier survol d'un élément [data-mode-blanc]
  // ou au clic sur le rond. Le halo bleu prend la taille data-echelle de
  // l'élément survolé et la garde ensuite.
  document.querySelectorAll('[data-mode-blanc], [data-echelle]').forEach(function (el) {
    auSurvol(el, function () {
      if (el.hasAttribute('data-mode-blanc')) body.classList.add('mode-blanc');
      var echelle = el.getAttribute('data-echelle');
      if (echelle && rondBleu) rondBleu.style.transform = 'scale3d(' + echelle + ', ' + echelle + ', 1)';
    });
  });

  var halo = document.querySelector('.rond__halo');
  if (halo) {
    halo.addEventListener('click', function () {
      body.classList.add('mode-blanc');
    });
  }

  // Aperçus : un lien [data-apercu="x"] affiche l'image #apercu-x au survol
  document.querySelectorAll('[data-apercu]').forEach(function (lien) {
    var image = document.getElementById('apercu-' + lien.getAttribute('data-apercu'));
    if (!image) return;
    auSurvol(lien, function () { image.classList.add('est-visible'); });
    lien.addEventListener('mouseleave', function () { image.classList.remove('est-visible'); });
  });

  /* 3. Diaporama -----------------------------------------------------------
     - défilement toutes les data-delai ms (si data-auto), en pause tant que
       la souris est sur le diaporama, arrêté définitivement au premier clic
       ou toucher ;
     - transition : l'image sortante s'efface (150 ms) puis l'entrante
       apparaît (150 ms) ;
     - zones « précédent » / « suivant », clavier et glissé du doigt. */
  document.querySelectorAll('.diaporama').forEach(function (diaporama) {
    var diapos = Array.prototype.slice.call(diaporama.querySelectorAll('.diaporama__diapo'));
    var DEMI_FONDU = 150;
    var delai = parseInt(diaporama.getAttribute('data-delai'), 10) || 3000;
    var auto = diaporama.hasAttribute('data-auto');
    var index = 0;
    var minuteur = null;
    var arrete = false;
    var profondeur = 1; // la diapositive entrante passe au-dessus

    if (!diapos.length) return;
    diapos[0].classList.add('est-active');
    if (diapos.length < 2) {
      diaporama.classList.add('diaporama--une-image');
      return;
    }

    function montrer(nouvelIndex) {
      var sortante = diapos[index];
      index = (nouvelIndex + diapos.length) % diapos.length;
      var entrante = diapos[index];
      if (sortante === entrante) return;

      sortante.style.opacity = '0';
      entrante.style.transition = 'none';
      entrante.style.opacity = '0';
      entrante.classList.add('est-active');
      entrante.style.zIndex = String(++profondeur);
      void entrante.offsetWidth; // applique l'opacité 0 avant la transition
      entrante.style.transition = '';
      setTimeout(function () {
        entrante.style.opacity = '1';
      }, DEMI_FONDU);
      setTimeout(function () {
        if (diapos[index] !== sortante) {
          sortante.classList.remove('est-active');
          sortante.style.opacity = '';
        }
      }, DEMI_FONDU * 2);
    }

    function suivante() { montrer(index + 1); }
    function precedente() { montrer(index - 1); }

    function lancer() {
      clearTimeout(minuteur);
      if (!auto || arrete) return;
      minuteur = setTimeout(function () {
        suivante();
        lancer();
      }, delai);
    }

    function pause() { clearTimeout(minuteur); }

    function arreter() {
      arrete = true;
      pause();
    }

    var flechePrecedente = diaporama.querySelector('.diaporama__fleche--precedent');
    var flecheSuivante = diaporama.querySelector('.diaporama__fleche--suivant');
    [[flechePrecedente, precedente], [flecheSuivante, suivante]].forEach(function (paire) {
      var fleche = paire[0];
      var action = paire[1];
      if (!fleche) return;
      fleche.addEventListener('click', action);
      fleche.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          action();
        }
      });
    });

    diaporama.addEventListener('mousedown', arreter);
    diaporama.addEventListener('touchstart', arreter, { passive: true });
    diaporama.addEventListener('mouseenter', pause);
    diaporama.addEventListener('mouseleave', lancer);
    diaporama.addEventListener('focusin', pause);
    diaporama.addEventListener('focusout', lancer);

    // Glissé horizontal du doigt
    var departX = null;
    var departY = null;
    diaporama.addEventListener('touchstart', function (e) {
      departX = e.touches[0].clientX;
      departY = e.touches[0].clientY;
    }, { passive: true });
    diaporama.addEventListener('touchend', function (e) {
      if (departX === null) return;
      var dx = e.changedTouches[0].clientX - departX;
      var dy = e.changedTouches[0].clientY - departY;
      departX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) suivante();
        else precedente();
      }
    });

    lancer();
  });
})();
