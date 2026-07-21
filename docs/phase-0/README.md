# Phase 0 — Discovery et cadrage

Statut : **décisions produit V1 intégrées; en attente des seules décisions techniques restantes**.

Produit cible : **Nodra**. Le nom **DevFlow** est conservé uniquement pour désigner le MVP historique et les missions d'analyse exécutées dans celui-ci.

Cette phase documente le MVP réel avant toute réimplémentation. Le périmètre fonctionnel V1 et la direction backend sont maintenant validés; l'architecture détaillée reste un jalon distinct.

## Livrables

- `00-refactor-charter.md` — mandat, sources, règles de preuve et garde-fous.
- `analyses/` — rapports spécialisés sourcés et non chevauchants.
- `01-as-is-functional-map.md` — cartographie fonctionnelle observée.
- `02-functional-prd.md` — besoin et exigences fonctionnelles, sans solution technique imposée.
- `03-product-questions.md` — décisions à obtenir et questions ouvertes.
- `04-non-functional-requirements.md` — squelette NFR limité aux contraintes validées; cibles mesurables différées.
- `05-target-architecture.md` — contraintes et options, sans choix structurant figé.
- `06-migration-strategy.md` — décision de base propre; trajectoire détaillée différée.
- `analyses/mission-log.md` — traçabilité des missions DevFlow et de leur arrêt budgétaire.

Risques détaillés, backlog priorisé, ADR techniques et architecture approfondie sont volontairement différés jusqu'aux décisions techniques ouvertes.

## État des affirmations

Chaque livrable utilise autant que possible les marqueurs suivants :

- **OBS** — comportement ou structure observé et relié à une preuve.
- **INT** — intention exprimée par la documentation ou l'interface, non confirmée par le comportement.
- **HYP** — hypothèse de travail à vérifier.
- **DEC-P** — décision proposée, non validée.
- **DEC-V** — décision explicitement validée par le propriétaire produit.
- **Q** — question ouverte.

En cas de divergence, l'ordre de preuve est : comportement ou test exécutable, contrat/API et modèle de domaine, interface, puis documentation et roadmap.
