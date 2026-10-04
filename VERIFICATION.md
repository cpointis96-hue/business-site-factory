# Vérification du 4 octobre 2026

Source originale : `db6eb13d3f151e53aed0bb50974665c22e59bd73`.

Environnement : Node.js 26.7.0 sur macOS. Node.js 22 est déclaré comme minimum mais n’a pas été exercé dans cette préparation.

- `npm test` : 116 tests réussis, aucun échec, aucun test ignoré. Les tests HTTP nécessitent l’autorisation d’ouvrir un port loopback ; un premier essai sous sandbox a échoué avec `EPERM`, puis la suite a réussi hors de cette restriction.
- `npm run check` : réussi.
- Vérification `node --check` de chacun des 76 modules dans `src/`, `app/` et `test/` : réussie.
- Aucun build, linter ou typecheck distinct n’est défini. Aucun paquet externe, lockfile ou script d’installation n’est nécessaire.
- `PORT=4187 ANCRAGE_DATA_DIR=…/.ancrage-verification npm run dev` : démarrage local réussi, avec données de vérification isolées.

Les tests couvrent stockage, versions, workflows, coûts, registres, contrôles réseau, API, dossiers, génération synthétique et reprise. Les clés et adaptateurs utilisés sont des doubles de test. Aucun fournisseur réel, achat, envoi ou publication distante n’a été exercé.

Playwright a chargé le cockpit, ouvert Configuration puis chargé l’intake. Captures réelles : [cockpit](docs/screenshots/cockpit.png), [configuration](docs/screenshots/configuration.png), [intake mobile](docs/screenshots/intake-mobile.png). À 390 × 844, l’intake a une largeur de document de 390 px, sans débordement horizontal. Le cockpit présente son état vide, issu d’un répertoire de données neuf. Une erreur console `404 /favicon.ico` existe dans le cockpit ; aucun autre message console n’a été observé lors de cette navigation. L’audit payant n’a pas été soumis. Cette vérification limitée ne couvre pas toutes les interactions du navigateur.

Le trousseau macOS, la restauration réelle et les intégrations externes restent à vérifier. Une recherche de motifs courants de clés et chemins personnels dans la copie n’a trouvé aucun résultat ; ce contrôle n’est pas une certification exhaustive.
