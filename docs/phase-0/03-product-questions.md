# Registre des décisions et questions résiduelles

## Décisions produit closes

| ID | DEC-V |
| --- | --- |
| D-00 | Le nouveau produit s'appelle **Nodra**. DevFlow désigne uniquement le MVP historique analysé. |
| D-01 | Local-first, mono-utilisateur, sans SaaS, comptes, rôles ni collaboration. |
| D-02 | Base transactionnelle locale propre; aucune migration/rétrocompatibilité des données historiques MVP. Logs et artefacts volumineux séparés; export/import manuel simple. |
| D-03 | Codex et Copilot initiaux, extension future sans coupler le domaine aux protocoles provider. |
| D-04 | Relais unique : prêt, actif, bloqué, décision requise. Projets comme contexte/filtre et page secondaire; pas de page Agents V1. |
| D-05 | Projet implicite pour un dépôt, facultatif pour scratch; vocabulaire Mission, Pipeline, Manager, Provider. |
| D-06 | Capture titre seul; mission humaine sans agent autorisée. Lifecycle : brouillon, prête, active, bloquée, à valider, terminée, abandonnée. |
| D-07 | Succès agent mène à à valider; seule l'acceptation utilisateur termine. Résultat déclaré, observations et validation humaine sont distincts. |
| D-08 | Séquence composable dès la création. Pipeline V1 : dépendances, handovers, gates, relance ciblée, démarrage configurable et archivage explicite. Routeurs/templates après V1. |
| D-09 | Manager : crée/supervise le non destructif; confirmation pour sensible ou création d'un manager. Prompt mère global avant instruction manager puis brief, visible et snapshoté. Budgets globaux/par mission souples avec confirmation de dépassement. |
| D-10 | Socle produit provider requis : disponibilité, modèles, start, événements, stop, résultat, reprise, queue, steer, usage, pièces jointes. Incapacité visible, non simulée, sans fallback. |
| D-11 | Provider par mission, défaut projet configurable, aucun changement sans consentement. Tous les paramètres modèle/réflexion accessibles progressivement. |
| D-12 | Dépôt, scratch, worktree V1; worktree recommandé pour modifier un dépôt. Intégration toujours confirmée; auto-commit seulement autorisé par mission; suppression avec cible exacte. |
| D-13 | Tous les MCP disponibles par défaut, visibles et contrôlables par mission. Presets permission visibles; full access par défaut; secrets hors Nodra. |
| D-14 | Reprise après crash requise; macOS, Linux, Windows; application web locale lancée par CLI; WCAG 2.1 AA critiques; notifications in-app; métriques décisionnelles secondaires. |
| D-15 | Direction backend hexagonale/modulaire validée; pas de copie du découpage accidentel MVP. |
| D-16 | Temporal self-host local est le moteur durable retenu; Temporal Cloud est hors architecture. Nodra supervise un runtime téléchargé et versionné. |
| D-17 | TypeScript strict, NestJS/Express, React/Vite. SQLite Nodra est la vérité métier; Temporal est le journal et contrôleur d'exécution, sans double écriture fragile. |
| D-18 | Codex V1 s'intègre d'abord au Codex app-server JSON-RPC; GitHub Copilot V1 au SDK officiel. |
| D-19 | Budgets V1 : plafond global hebdomadaire et plafond mission sur toute sa durée de vie, seuils confirmables; override borné/auditable; hard-cap seulement si explicitement configuré. |
| D-20 | Rétention V1 : conservation indéfinie; suppression soft-delete restaurable; aucune purge automatique; purge manuelle confirmée seulement pour blobs non référencés. |
| D-21 | Briefing V1 : seul l'historique neuf Nodra est consultable; aucun import DevFlow; génération dédiée après V1. |

## Questions techniques réellement restantes

| ID | Décision attendue ultérieurement | Contradiction / raison |
| --- | --- | --- |
| Q-T01 | Aucun choix d'architecture bloquant restant | Les spécifications `docs/technical/` fixent preuve, SQLite, Temporal, permissions et packaging; les limites de capacités réelles providers et du runtime sont des critères de POC, pas un prétexte à simuler. |

Les seules questions de propriétaire restantes sont recensées dans le gate de `docs/technical/README.md`.
