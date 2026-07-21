# Stratégie de transition — décision de base propre

- **DEC-V** — Aucun import, migration ou support des données historiques de `api-v2`.
- **DEC-V** — Aucun objectif de compatibilité avec ses fichiers JSON, routes HTTP, identifiants ou champs historiques.
- **DEC-V** — La nouvelle base utilise un état métier transactionnel local; logs et artefacts volumineux sont séparés. Un export/import manuel simple sert à la sauvegarde de la nouvelle base.
- **DEC-P** — Conserver un catalogue de concepts et de critères d'acceptation comme référence de parité fonctionnelle.
- **DEC-P** — Lorsque l'implémentation sera autorisée, utiliser un répertoire de données et des ports distincts afin de permettre une évaluation côte à côte sans toucher au MVP.

La trajectoire d'implémentation et le plan de bascule sont différés après validation séparée du PRD et de l'architecture.
