#!/usr/bin/env node
/* ==========================================================================
   build.mjs — génère les pages HTML du site (FR à la racine, EN dans /en/)
   --------------------------------------------------------------------------
   Usage :  node build.mjs
   Entrées : content/accueil.md, content/projets/*.md,
             templates/accueil.html, templates/projet.html
   Sorties : index.html, <slug>.html, en/index.html, en/<slug>.html,
             sitemap.xml, robots.txt, llms.txt (référencement)
   Aucune dépendance : Node 18 ou plus suffit.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.dirname(fileURLToPath(import.meta.url));
const SITE = 'https://www.jimenazuniga.com/';
const LANGUES = ['fr', 'en'];

// Textes fixes de l'interface, par langue
const TEXTES = {
  fr: {
    projets: 'projets',
    suivant: { projet: 'projet suivant', agence: 'agence suivante' },
    precedent_aria: 'image précédente',
    suivant_aria: 'image suivante',
  },
  en: {
    projets: 'projects',
    suivant: { projet: 'next project', agence: 'next studio' },
    precedent_aria: 'previous image',
    suivant_aria: 'next image',
  },
};

// Largeur d'affichage des visuels (pour l'attribut sizes des images)
const TAILLES = {
  5: '(max-width: 479px) 92vw, 42vw',
  6: '(max-width: 479px) 92vw, 50vw',
  7: '(max-width: 479px) 92vw, 59vw',
  plein: '(max-width: 479px) 200vw, 65vw',
};
const VARIANTES = [800, 1600]; // images/<nom>-800.jpg, images/<nom>-1600.jpg

let avertissements = 0;
function avertir(message) {
  avertissements++;
  console.warn('⚠ ' + message);
}

/* --- Lecture des fichiers .md --------------------------------------------
   Format : un en-tête entre deux lignes « --- » (lignes « clé: valeur » et
   listes « - élément »), puis des sections « ## titre ». */
function lireFichier(chemin) {
  const brut = fs.readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
  const m = brut.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${chemin} : en-tête « --- » manquant`);

  const meta = {};
  let listeEnCours = null;
  for (const ligne of m[1].split('\n')) {
    if (!ligne.trim() || ligne.trim().startsWith('#')) continue;
    const element = ligne.match(/^\s+-\s+(.*)$/);
    if (element && listeEnCours) {
      meta[listeEnCours].push(element[1].trim());
      continue;
    }
    const paire = ligne.match(/^([\w-]+):\s*(.*)$/);
    if (!paire) throw new Error(`${chemin} : ligne incomprise « ${ligne} »`);
    const [, cle, valeur] = paire;
    if (valeur === '') {
      meta[cle] = [];
      listeEnCours = cle;
    } else {
      meta[cle] = valeur.trim();
      listeEnCours = null;
    }
  }

  const sections = {};
  let titre = null;
  for (const ligne of m[2].split('\n')) {
    const h = ligne.match(/^##\s+(.*)$/);
    if (h) {
      titre = h[1].trim().toLowerCase();
      sections[titre] = [];
    } else if (titre) {
      sections[titre].push(ligne);
    }
  }
  for (const cle of Object.keys(sections)) sections[cle] = sections[cle].join('\n').trim();
  return { meta, sections };
}

/* --- Texte → HTML ---------------------------------------------------------
   [texte](url) devient un lien ; un retour à la ligne devient <br> ;
   une ligne vide devient <br><br>. */
// « &nbsp; » (espace insécable) est conservé tel quel dans les textes
function echapper(texte) {
  return String(texte).replace(/&(?!nbsp;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function echapperAttribut(texte) {
  return echapper(texte).replace(/"/g, '&quot;');
}

function texteEnHtml(texte, classeLien = 'lien-texte') {
  return echapper(texte)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, url) =>
      `<a href="${url.replace(/"/g, '&quot;')}" target="_blank" class="${classeLien}">${t}</a>`)
    .replace(/\n/g, '<br>');
}

/* --- Images ----------------------------------------------------------------
   Lit la largeur d'un JPEG (sans dépendance) pour construire le srcset. */
function largeurJpeg(chemin) {
  const d = fs.readFileSync(chemin);
  let i = 2;
  while (i < d.length) {
    if (d[i] !== 0xff) { i++; continue; }
    const marqueur = d[i + 1];
    const longueur = d.readUInt16BE(i + 2);
    if (marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur)) {
      return d.readUInt16BE(i + 7);
    }
    i += 2 + longueur;
  }
  return null;
}

function verifierImage(nom, contexte) {
  if (!fs.existsSync(path.join(RACINE, 'images', nom))) avertir(`${contexte} : image introuvable images/${nom}`);
}

function balisesSrcset(nom, racine) {
  const base = nom.replace(/\.jpe?g$/i, '');
  if (base === nom) return '';
  const candidats = [];
  for (const largeur of VARIANTES) {
    const variante = `${base}-${largeur}.jpg`;
    if (fs.existsSync(path.join(RACINE, 'images', variante))) candidats.push(`${racine}images/${variante} ${largeur}w`);
  }
  if (!candidats.length) return '';
  const largeur = largeurJpeg(path.join(RACINE, 'images', nom));
  if (largeur) candidats.push(`${racine}images/${nom} ${largeur}w`);
  return ` srcset="${candidats.join(', ')}"`;
}

/* --- Chargement du contenu ----------------------------------------------- */
const accueil = lireFichier(path.join(RACINE, 'content', 'accueil.md'));

const dossierProjets = path.join(RACINE, 'content', 'projets');
const projets = fs.readdirSync(dossierProjets)
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const { meta, sections } = lireFichier(path.join(dossierProjets, f));
    const slug = f.replace(/\.md$/, '');
    return {
      slug,
      ...meta,
      aUnePage: meta.page !== 'non',
      sections,
      images: (meta.images || []).map((ligne) => {
        const [fichier, largeur = '6', option = ''] = ligne.split('|').map((x) => x.trim());
        if (!['5', '6', '7'].includes(largeur)) avertir(`${slug} : largeur « ${largeur} » inconnue pour ${fichier} (5, 6 ou 7)`);
        return { fichier, largeur, plein: option === 'plein' };
      }),
    };
  });
const parSlug = Object.fromEntries(projets.map((p) => [p.slug, p]));

// Vérifications
for (const p of projets) {
  if (!['projets', 'collaborations', 'events'].includes(p.rubrique)) avertir(`${p.slug} : rubrique « ${p.rubrique} » inconnue`);
  if (p.apercu) verifierImage(p.apercu, p.slug);
  if (!p.aUnePage) continue;
  if (!p.images.length) avertir(`${p.slug} : aucune image`);
  p.images.forEach((img) => verifierImage(img.fichier, p.slug));
  if (p.suivant && !parSlug[p.suivant]?.aUnePage) avertir(`${p.slug} : page suivante « ${p.suivant} » introuvable`);
  for (const lang of LANGUES) if (!p.sections[lang]) avertir(`${p.slug} : section « ## ${lang} » manquante`);
}

/* --- Éléments partagés ----------------------------------------------------- */
const ecrits = new Set();

function remplir(modele, valeurs) {
  return modele.replace(/\{\{(\w+)\}\}/g, (_, cle) => {
    if (!(cle in valeurs)) throw new Error(`Valeur manquante pour {{${cle}}}`);
    return valeurs[cle];
  });
}

function ecrire(relatif, contenu) {
  const cible = path.join(RACINE, relatif);
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  fs.writeFileSync(cible, contenu);
  ecrits.add(path.normalize(relatif));
}

// <link rel="alternate" hreflang> : même page dans les deux langues
function liensLangues(fichier) {
  const url = (lang) => SITE + (lang === 'en' ? 'en/' : '') + (fichier === 'index.html' ? '' : fichier);
  return [
    `  <link rel="alternate" hreflang="fr" href="${url('fr')}">`,
    `  <link rel="alternate" hreflang="en" href="${url('en')}">`,
    `  <link rel="alternate" hreflang="x-default" href="${url('fr')}">`,
  ].join('\n');
}

// Sélecteur « fr/en » : vrais liens vers la page équivalente
function selecteurLangue(fichier, lang) {
  const versFr = lang === 'fr' ? fichier : `../${fichier}`;
  const versEn = lang === 'en' ? fichier : `en/${fichier}`;
  const classe = (l) => (l === lang ? ' class="langue-active" aria-current="page"' : '');
  return `<a href="${versFr}" lang="fr" hreflang="fr"${classe('fr')}>fr</a>` +
    `<span>/</span>` +
    `<a href="${versEn}" lang="en" hreflang="en"${classe('en')}>en</a>`;
}

const traduit = (p, cle, lang) => (lang === 'en' && p[`${cle}_en`]) || p[cle];

/* --- Référencement (invisible à l'écran) ----------------------------------
   Description, aperçus de partage (Open Graph), données structurées
   schema.org (JSON-LD), sitemap.xml, robots.txt et llms.txt.
   Règle : on ne présente jamais Jimena comme autrice d'un projet ; une page
   « collaborations » parle de l'agence, une page projet décrit le projet,
   et c'est le texte de la page qui dit quel a été son rôle. */
const A = accueil.meta;
const NOM = A.nom || 'Jimena Zúñiga';
const LINKEDIN = typeof A.linkedin === 'string' ? A.linkedin : '';
// Titre d'onglet et d'aperçu de partage : « Jimena Zúñiga – Conceptrice lumière »,
// précédé du nom du projet sur les pages projet
const JIMENA = { '@type': 'Person', '@id': `${SITE}#jimena`, name: NOM }; // référence à sa fiche
const titreSite = (lang) => `${NOM} – ${lang === 'en' ? A.metier_en : A.metier}`;
// « Jimena Zúñiga, Victor Mauro » → personnes schema.org (Jimena = sa fiche)
const personnes = (liste = '') => liste.split(',').map((n) => n.trim()).filter(Boolean)
  .map((nom) => (nom === NOM ? JIMENA : { '@type': 'Person', name: nom }));
const urlPage = (fichier, lang) => SITE + (lang === 'en' ? 'en/' : '') + (fichier === 'index.html' ? '' : fichier);

// Texte brut à partir du Markdown (liens, retours à la ligne, &nbsp;)
function texteBrut(texte = '') {
  return texte
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Description : champ « description » du .md, sinon début du texte (≈ 160 caractères)
function resumer(texte, max = 160) {
  const brut = texteBrut(texte);
  if (brut.length <= max) return brut;
  const phrases = brut.match(/[^.!?]+[.!?]+/g) || [];
  let resultat = '';
  for (const phrase of phrases) {
    if ((resultat + phrase).length > max) break;
    resultat += phrase;
  }
  if (resultat.trim().length >= 80) return resultat.trim();
  return brut.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function urlImage(nom) {
  const base = nom.replace(/\.jpe?g$/i, '');
  const grande = `${base}-1600.jpg`;
  return SITE + 'images/' + (base !== nom && fs.existsSync(path.join(RACINE, 'images', grande)) ? grande : nom);
}

function jsonLd(objet) {
  return `  <script type="application/ld+json">\n${JSON.stringify(objet, null, 2).replace(/</g, '\\u003c').replace(/^/gm, '  ')}\n  </script>`;
}

// Balises <head> : description, canonical, Open Graph, Twitter, JSON-LD
function balisesSeo({ lang, fichier, titre, description, image, donnees }) {
  const url = urlPage(fichier, lang);
  const attr = echapperAttribut;
  return [
    `  <meta name="description" content="${attr(description)}">`,
    `  <link rel="canonical" href="${url}">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:site_name" content="${attr(NOM)}">`,
    `  <meta property="og:title" content="${attr(titre)}">`,
    `  <meta property="og:description" content="${attr(description)}">`,
    `  <meta property="og:url" content="${url}">`,
    `  <meta property="og:image" content="${image}">`,
    `  <meta property="og:locale" content="${lang === 'fr' ? 'fr_FR' : 'en_US'}">`,
    `  <meta property="og:locale:alternate" content="${lang === 'fr' ? 'en_US' : 'fr_FR'}">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${attr(titre)}">`,
    jsonLd(donnees),
  ].join('\n');
}

const SITE_WEB = { '@type': 'WebSite', '@id': `${SITE}#site`, url: SITE, name: NOM, inLanguage: ['fr', 'en'], author: JIMENA };

function personne(lang) {
  const lignes = (accueil.sections.adresse || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const ville = (lignes[lignes.length - 1] || '').match(/^(\d{5})\s+(.+)$/);
  return {
    '@type': 'Person',
    '@id': `${SITE}#jimena`,
    name: NOM,
    alternateName: NOM.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    jobTitle: lang === 'en' ? A.metier_en : A.metier,
    description: texteBrut(accueil.sections[`description ${lang}`]),
    url: urlPage('index.html', lang),
    image: urlImage(A.image_partage),
    email: `mailto:${A.email}`,
    telephone: A.telephone.replace(/\s/g, ''),
    address: {
      '@type': 'PostalAddress',
      ...(lignes.length >= 2 && ville ? { streetAddress: lignes[lignes.length - 2], postalCode: ville[1], addressLocality: ville[2] } : {}),
      addressCountry: 'FR',
    },
    sameAs: [A.instagram, LINKEDIN].filter(Boolean),
    knowsAbout: (lang === 'en' ? A.domaines_en : A.domaines) || [],
    alumniOf: (A.formations || []).map((nom) => ({ '@type': 'EducationalOrganization', name: nom })),
  };
}

function descriptionProjet(p, lang) {
  return (lang === 'en' && p.description_en) || p.description || resumer(p.sections[lang]);
}

/* --- Accueil --------------------------------------------------------------- */
function listeAccueil(rubrique, lang) {
  const elements = projets
    .filter((p) => p.rubrique === rubrique && p.accueil && p.accueil !== 'non')
    .sort((a, b) => Number(a.ordre) - Number(b.ordre));
  return elements.map((p) => {
    const libelle = echapper(traduit(p, 'accueil', lang));
    const apercu = p.apercu ? ` data-apercu="${p.slug}"` : '';
    // Events : liens de texte (bleus sur mobile, sauf vidéos externes) ; sinon liens de liste
    let classe = rubrique === 'events' ? 'lien-texte' : 'lien-liste';
    if (rubrique === 'events' && p.lien) classe += ' lien-texte--orange-mobile';
    if (p.lien) return `<a href="${echapperAttribut(p.lien)}" target="_blank" class="${classe}"${apercu}>${libelle}</a>`;
    if (p.aUnePage) return `<a href="${p.slug}.html" class="${classe}"${apercu}>${libelle}</a>`;
    return libelle;
  });
}

function construireAccueil(lang) {
  const racine = lang === 'fr' ? '' : '../';
  const a = accueil.meta;
  const contact = [
    `<a href="${echapperAttribut(a.adresse_lien)}" target="_blank" class="lien-texte lien-texte--orange-mobile">${texteEnHtml(accueil.sections.adresse)}</a>`,
    `<a href="tel:${a.telephone.replace(/\s/g, '')}" class="lien-texte lien-texte--orange-mobile">${echapper(a.telephone)}</a>`,
    `<a href="mailto:${a.email}" class="lien-texte lien-texte--orange-mobile">${echapper(a.email)}</a>`,
  ].join('<br>');
  const news = `<a href="${echapperAttribut(a.news_lien)}" target="_blank" class="lien-texte" data-apercu="news">${texteEnHtml(accueil.sections[`news ${lang}`])}</a>`;

  const apercus = projets
    .filter((p) => p.apercu && p.accueil && p.accueil !== 'non')
    .map((p) => ({ id: p.slug, image: p.apercu, position: p.apercu_position }))
    .concat([{ id: 'news', image: a.news_apercu, position: a.news_apercu_position }])
    .map((x) => `  <img src="${racine}images/${x.image}" alt="" id="apercu-${x.id}" class="apercu apercu--${x.position}">`)
    .join('\n');

  const html = remplir(fs.readFileSync(path.join(RACINE, 'templates', 'accueil.html'), 'utf8'), {
    lang,
    racine,
    titre: echapper(titreSite(lang)),
    liens_langues: liensLangues('index.html'),
    seo: balisesSeo({
      lang,
      fichier: 'index.html',
      titre: titreSite(lang),
      description: texteBrut(accueil.sections[`description ${lang}`]),
      image: urlImage(a.image_partage),
      donnees: {
        '@context': 'https://schema.org',
        '@graph': [SITE_WEB, personne(lang), {
          '@type': 'WebPage',
          '@id': urlPage('index.html', lang),
          url: urlPage('index.html', lang),
          name: titreSite(lang),
          inLanguage: lang,
          isPartOf: { '@id': `${SITE}#site` },
          about: { '@id': `${SITE}#jimena` },
        }],
      },
    }),
    bio: texteEnHtml(accueil.sections[`bio ${lang}`]),
    libelle_projets: TEXTES[lang].projets,
    liste_projets: listeAccueil('projets', lang).join('<br>'),
    liste_collaborations: listeAccueil('collaborations', lang).join(''),
    liste_events: listeAccueil('events', lang).join('<br>'),
    selecteur_langue: selecteurLangue('index.html', lang),
    contact,
    instagram: echapperAttribut(a.instagram),
    news,
    apercus,
  });
  ecrire(`${lang === 'fr' ? '' : 'en/'}index.html`, html);
}

/* --- Pages projet ------------------------------------------------------------ */
function construireProjet(p, lang) {
  const racine = lang === 'fr' ? '' : '../';
  const titre = echapper(traduit(p, 'titre', lang));
  const diapos = p.images.map((img) => {
    const classes = `visuel visuel--${img.largeur}${img.plein ? ' visuel--plein' : ''}`;
    const sizes = TAILLES[img.plein ? 'plein' : img.largeur];
    const srcset = balisesSrcset(img.fichier, racine);
    return `      <div class="diaporama__diapo"><img src="${racine}images/${img.fichier}"${srcset}${srcset ? ` sizes="${sizes}"` : ''} alt="${echapperAttribut(traduit(p, 'titre', lang))}" class="${classes}"></div>`;
  }).join('\n');

  const lienSuivant = p.suivant
    ? `  <a href="${p.suivant}.html" class="lien-suivant">${TEXTES[lang].suivant[p.suivant_libelle || 'projet']}</a>\n`
    : '';

  const html = remplir(fs.readFileSync(path.join(RACINE, 'templates', 'projet.html'), 'utf8'), {
    lang,
    racine,
    slug: p.slug,
    titre,
    titre_onglet: echapper(`${traduit(p, 'titre', lang)} | ${titreSite(lang)}`),
    liens_langues: liensLangues(`${p.slug}.html`),
    seo: balisesSeo({
      lang,
      fichier: `${p.slug}.html`,
      titre: `${traduit(p, 'titre', lang)} | ${titreSite(lang)}`,
      description: descriptionProjet(p, lang),
      image: urlImage(p.images[0].fichier),
      donnees: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        '@id': urlPage(`${p.slug}.html`, lang),
        url: urlPage(`${p.slug}.html`, lang),
        name: traduit(p, 'titre', lang),
        description: descriptionProjet(p, lang),
        inLanguage: lang,
        isPartOf: SITE_WEB,
        primaryImageOfPage: urlImage(p.images[0].fichier),
        // Collaborations : la page parle de l'agence ; sinon, du projet (sans auteur déclaré)
        about: p.rubrique === 'collaborations'
          ? { '@type': 'Organization', name: p.titre }
          : {
            '@type': 'CreativeWork',
            name: traduit(p, 'titre', lang),
            ...((p.accueil || '').match(/\b(19|20)\d{2}\b/) ? { dateCreated: p.accueil.match(/\b(19|20)\d{2}\b/)[0] } : {}),
            // Auteurs et participants : uniquement s'ils sont indiqués dans le .md
            ...(p.auteurs ? { creator: personnes(p.auteurs) } : {}),
            ...(p.avec ? { contributor: personnes(p.avec) } : {}),
          },
      },
    }),
    mise_en_page: p.rubrique === 'collaborations' ? 'agence' : 'projet',
    classe_texte: p.texte_mobile_plein_ecran === 'oui' ? ' contenu--plein-ecran' : '',
    texte: texteEnHtml(p.sections[lang] || ''),
    options_diaporama: p.diaporama === 'fixe' ? '' : ' data-auto data-delai="3000"',
    diapos,
    aria_precedent: TEXTES[lang].precedent_aria,
    aria_suivant: TEXTES[lang].suivant_aria,
    lien_suivant: lienSuivant,
    selecteur_langue: selecteurLangue(`${p.slug}.html`, lang),
  });
  ecrire(`${lang === 'fr' ? '' : 'en/'}${p.slug}.html`, html);
}

/* --- Génération ---------------------------------------------------------------- */
for (const lang of LANGUES) {
  construireAccueil(lang);
  for (const p of projets) if (p.aUnePage) construireProjet(p, lang);
}

/* --- sitemap.xml, robots.txt, llms.txt -------------------------------------- */
const fichiersPages = ['index.html', ...projets.filter((p) => p.aUnePage).map((p) => `${p.slug}.html`)];
ecrire('sitemap.xml', [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...fichiersPages.flatMap((f) => LANGUES.map((lang) => [
    '  <url>',
    `    <loc>${urlPage(f, lang)}</loc>`,
    ...LANGUES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${urlPage(f, l)}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${urlPage(f, 'fr')}"/>`,
    '  </url>',
  ].join('\n'))),
  '</urlset>',
  '',
].join('\n'));

ecrire('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);

// llms.txt : résumé en texte simple pour les assistants IA (convention llmstxt.org)
const rubriquesLlms = [
  ['projets', 'Projets'],
  ['collaborations', 'Collaborations avec des agences de conception lumière (le texte précise le rôle de Jimena)'],
  ['events', 'Événements, workshops et conférences'],
];
// Texte Markdown sur une ligne (liens conservés)
const enLigne = (texte = '') => texte.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const ligneLlms = (p) => {
  if (!p.aUnePage) return p.lien ? `- [${p.titre}](${p.lien})` : `- ${p.titre}`;
  const credits = [p.auteurs && `Auteurs : ${p.auteurs}`, p.avec && `Avec : ${p.avec}`].filter(Boolean).join(' ; ');
  return `- [${p.titre}](${urlPage(`${p.slug}.html`, 'fr')})${credits ? ` (${credits})` : ''} — ${enLigne(p.sections.fr)}`;
};
ecrire('llms.txt', [
  `# ${NOM}`,
  '',
  `> ${texteBrut(accueil.sections['description fr'])}`,
  `> ${texteBrut(accueil.sections['description en'])}`,
  '',
  enLigne(accueil.sections['bio fr']),
  '',
  ...rubriquesLlms.flatMap(([rubrique, intitule]) => [
    `## ${intitule}`,
    '',
    ...projets
      .filter((p) => p.rubrique === rubrique)
      .sort((a, b) => (Number(a.ordre) || 99) - (Number(b.ordre) || 99))
      .map(ligneLlms),
    '',
  ]),
  '## Contact',
  '',
  `- Atelier : ${texteBrut(accueil.sections.adresse)}`,
  `- Téléphone : ${A.telephone}`,
  `- E-mail : ${A.email}`,
  `- Instagram : ${A.instagram}`,
  ...(LINKEDIN ? [`- LinkedIn : ${LINKEDIN}`] : []),
  '',
  '## English',
  '',
  `- [English version of the website](${urlPage('index.html', 'en')})`,
  '',
].join('\n'));

// Supprime les anciennes pages générées dont le .md n'existe plus
for (const dossier of ['', 'en']) {
  const abs = path.join(RACINE, dossier);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    const relatif = path.normalize(path.join(dossier, f));
    if (!f.endsWith('.html') || ecrits.has(relatif)) continue;
    if (fs.readFileSync(path.join(abs, f), 'utf8').includes('Page générée par build.mjs')) {
      fs.unlinkSync(path.join(abs, f));
      console.log(`supprimé : ${relatif} (plus de fichier .md)`);
    }
  }
}

console.log(`${ecrits.size} fichiers générés${avertissements ? `, ${avertissements} avertissement(s)` : ''}.`);
