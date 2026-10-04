# Ancrage / Website Factory

Prototype local de cockpit pour préparer des dossiers d’établissement, orchestrer des workflows versionnés, produire des rapports d’audit et des aperçus de sites, puis les soumettre à une validation opérateur.

Le dépôt contient un moteur Node.js, une API HTTP sur loopback et une interface HTML/CSS/JavaScript. Ce n’est pas un service de production : les intégrations réelles, la publication et les opérations commerciales demandent encore une validation dans leur environnement cible.

## Démarrer

Node.js 22 ou supérieur est requis. Il n’y a aucune dépendance npm externe ni installation à effectuer.

```sh
npm test
npm run check
npm run dev
```

Ouvrir `http://127.0.0.1:4173` pour le cockpit et `http://127.0.0.1:4173/intake.html` pour l’entrée publique locale. `PORT` permet de changer le port. Les données et configurations sont créées dans `.ancrage/`; `ANCRAGE_DATA_DIR` permet de choisir un autre répertoire.

Depuis le cockpit, Configuration puis « Lancer un test » exécute un scénario synthétique. Les tests couvrent aussi création de dossier, rapports, aperçu de site, interruption et reprise. Le site issu de cette simulation est un aperçu déterministe, pas une preuve de génération commerciale par IA.

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
