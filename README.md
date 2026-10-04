# Ancrage / Website Factory

## En bref

**Ce que c’est :** un cockpit local pour préparer des dossiers d’établissement et suivre leur production.

**À quoi il sert :** enchaîner des étapes versionnées, produire un rapport d’audit et générer un aperçu de site avant validation par un opérateur.

**Ce qui a été réalisé :** moteur de workflow, API locale, interface de cockpit, entrée de dossier, rapports, aperçu de site et scénarios de reprise.

**Technologies :** Node.js, API HTTP locale, HTML, CSS et JavaScript.

Les intégrations réelles, la publication et les opérations commerciales demandent encore une validation dans leur environnement cible.

## Démarrer

Node.js 22 ou supérieur est requis. Il n’y a aucune dépendance npm externe ni installation à effectuer.

```sh
npm test
npm run check
npm run dev
```

Ouvrir `http://127.0.0.1:4173` pour le cockpit et `http://127.0.0.1:4173/intake.html` pour l’entrée publique locale. `PORT` permet de changer le port. Les données et configurations sont créées dans `.ancrage/`; `ANCRAGE_DATA_DIR` permet de choisir un autre répertoire.

`npm test` exécute les scénarios synthétiques de création de dossier, rapports, aperçu de site, interruption et reprise. Le site issu de cette simulation est un aperçu déterministe, pas une preuve de génération commerciale par IA.

## Ce qui est présent

- Stockage atomique sur fichiers, registres de dossiers, artefacts et démos.
- Prompts, contrats JSON, templates et workflows avec versions et références figées par exécution.
- Moteur de workflows, validations, checkpoints, reprises et suivi des coûts.
- Audit SEO borné et rapports avec provenance, statut partiel et contrôles des cibles réseau.
- Adaptateurs de fournisseurs et contrôle d’activation avant utilisation.

Les appels aux fournisseurs exigent leurs propres comptes, clés, quotas et parfois un budget. Sur macOS, les secrets passent par le trousseau (`com.ancrage.provider`). Sur les autres plateformes, le magasin par défaut est en mémoire : il n’offre pas de persistance des secrets. Aucune clé n’est incluse. Les tests injectent des adaptateurs et secrets synthétiques ; ils ne valident pas les fournisseurs en production.

## Télécharger et vérifier

Sur GitHub, choisir **Code → Download ZIP**, extraire l’archive et exécuter les commandes ci-dessus depuis sa racine. Les mêmes commandes fonctionnent avec un clone Git. Voir [VERIFICATION.md](VERIFICATION.md) pour les résultats et limites observés.

Cette copie publique conserve `app/`, `src/`, `fixtures/defaults/` et `test/`. Les données locales, secrets, notes internes, runbooks liés aux comptes réels et anciens prototypes sont exclus. L’historique original n’est pas transféré. L’interface et le code fonctionnel sont conservés sans nouvelle direction visuelle.

## Suite du travail

Valider les fournisseurs avec comptes dédiés et limites explicites ; vérifier le trousseau réel, la sauvegarde/restauration et les parcours navigateur avant un usage opérationnel. Publication, achat de domaine et envoi commercial ne sont pas validés par cette préparation.

## Dépôt et téléchargement

[Voir le dépôt](https://github.com/cpointis96-hue/business-site-factory) · [Télécharger les sources ZIP](https://github.com/cpointis96-hue/business-site-factory/archive/HEAD.zip). Le ZIP contient les sources, pas un service déployé.
