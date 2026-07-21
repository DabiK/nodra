# Exigences non fonctionnelles — squelette contraint

Statut : **contraintes V1 validées; seuils et mécanismes détaillés différés**.

## Contraintes déjà validées

- **NFR-01 / DEC-V** — Fonctionnement local-first et mono-utilisateur; aucun besoin de disponibilité SaaS, tenant, compte ou rôle.
- **NFR-02 / DEC-V** — Aucune exigence de migration ou rétrocompatibilité avec les données historiques du MVP.
- **NFR-03 / DEC-V** — Contrat provider stable, testé indépendamment pour Codex et Copilot, extensible sans dépendance du domaine à leurs protocoles.
- **NFR-04 / DEC-V** — Capacités optionnelles détectables et dégradation produit explicite; aucun fallback silencieux.
- **NFR-05 / DEC-V** — Aucune action coûteuse ou à effet de bord lors d'une simple inspection.
- **NFR-06 / DEC-V** — Données, dépôts et secrets restent locaux sauf transmission explicitement requise par un provider ou MCP choisi.
- **NFR-07 / DEC-V** — État métier transactionnel local; logs et artefacts volumineux séparés; export/import manuel simple; secrets jamais stockés par Nodra.
- **NFR-08 / DEC-V** — Reprise après crash des missions, files et pipelines; macOS, Linux et Windows sont supportés au lancement.
- **NFR-09 / DEC-V** — WCAG 2.1 AA sur les parcours critiques; interface simple avec divulgation progressive; notifications in-app uniquement.
- **NFR-10 / DEC-V** — Limites de concurrence globales et, si utile, par projet/provider. Budgets souples avec alerte et confirmation avant dépassement.
- **NFR-11 / DEC-V** — Direction backend hexagonale/modulaire pour testabilité et intégrations futures. Application web locale lancée par CLI.

## Familles à chiffrer après validation PRD

Seuils de performance locale, intégrité/récupération détaillée, concurrence exacte, sécurité fichiers/processus/Git, observabilité locale, matrice OS et limites de charge. Les mécanismes sont regroupés dans `Q-T01` à `Q-T05` afin de ne pas anticiper l'architecture.
