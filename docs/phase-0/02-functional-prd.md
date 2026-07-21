# PRD fonctionnel — périmètre V1 validé

## Objectif et utilisateur

**DEC-V** — **Nodra** réduit la charge mentale d'un développeur solo expérimenté en affichant immédiatement la prochaine action utile : mission prête, active, bloquée ou décision requise. V1 privilégie un cœur réduit extrêmement fiable, sans parité automatique avec le MVP DevFlow.

**DEC-V** — Le produit est local-first, mono-utilisateur, lancé comme application web locale par CLI. Les comptes, rôles, équipes, multi-tenant, collaboration temps réel et SaaS sont rejetés.

## Navigation et vocabulaire

**DEC-V** — Vocabulaire UI : **Mission**, **Pipeline**, **Manager**, **Provider**.

**DEC-V** — L'accueil est le **Relais** unique avec quatre files : prêt, actif, bloqué, décision requise. Les projets sont un contexte et un filtre avec une page secondaire. Il n'y a pas de page globale Agents en V1; relais, conversations et recherche suffisent.

## Périmètre V1 et critères d'acceptation

| ID | Exigence V1 | Critères d'acceptation testables |
| --- | --- | --- |
| FR-01 | Contexte projet | Une mission de dépôt reçoit un projet implicite; un scratch peut rester sans projet. La page projet secondaire filtre les missions sans modifier leur historique. |
| FR-02 | Capture et configuration | Une mission se crée avec le titre seul. La configuration agent est facultative; une mission peut rester une tâche personnelle sans agent ni run. |
| FR-03 | Lancement explicite | Créer, ouvrir, rechercher ou inspecter une mission ne crée ni run, ni session, ni appel provider. Affecter puis lancer est une action distincte et visible. |
| FR-04 | Lifecycle mission | États : brouillon, prête, active, bloquée, à valider, terminée, abandonnée. Une mission humaine peut passer de brouillon/prête à terminée ou abandonnée sans run. Une mission agent réussie passe à à valider, jamais directement à terminée. |
| FR-05 | Conversations et tentatives | Plusieurs runs/tentatives peuvent appartenir à une conversation; l'historique expose leur ordre, résultat et état. Une conversation est conservée jusqu'à suppression explicite. |
| FR-06 | Résultat et preuve | Chaque livraison sépare résultat déclaré par l'agent, observations Nodra et acceptation humaine. Une gate est satisfaite par une preuve structurée vérifiable, pas par une heuristique textuelle fragile. |
| FR-07 | Décision humaine | L'utilisateur accepte ou demande une correction avant de terminer une mission agent. Intégration Git, suppression workspace/branche, force et actions sensibles demandent une confirmation avec portée/cible visible. |
| FR-08 | Séquence ponctuelle | Dès la création, une mission peut dépendre d'une ou plusieurs missions; le démarrage dépendant est configurable automatique ou validation humaine. |
| FR-09 | Pipeline simple | V1 couvre dépendances, handovers, gates, relance ciblée et archivage explicite. Une mission autonome reste utilisable sans pipeline. |
| FR-10 | Manager | Un manager transforme un brief en missions/pipelines et supervise le travail. Il peut créer/lancer le non destructif; il demande confirmation pour le sensible et pour créer un autre manager. |
| FR-11 | Prompt mère et budgets | Le prompt effectif d'un manager est, dans cet ordre : prompt mère global configurable → instruction spécifique du manager → brief courant. Les trois segments et leur snapshot de run sont visibles à l'utilisateur. V1 applique un plafond global hebdomadaire et un plafond par mission sur toute sa durée de vie : seuils souples/confirmables, override borné et auditable; aucun hard-cap absolu par défaut. |
| FR-12 | Providers et modèles | Codex et Copilot sont initiaux. Le socle produit exigé est disponibilité, modèles, start, événements, stop, résultat, reprise, queue, steer, usage et pièces jointes. Le provider est choisi par mission, le défaut est configurable par projet, et aucun changement n'est automatique sans consentement. |
| FR-13 | Dégradation provider | Une capacité absente désactive le contrôle avec une raison; aucune simulation, donnée inventée ou fallback silencieux. Les paramètres modèle/réflexion sont tous accessibles par divulgation progressive. |
| FR-14 | Git et workspaces | V1 supporte dépôt existant, scratch et worktree. Le worktree isolé est recommandé par défaut pour modifier un dépôt. L'intégration Git est toujours confirmée; l'auto-commit nécessite une autorisation de la mission. |
| FR-15 | Accès outils et permissions | Tous les MCP sont disponibles par défaut et visibles/contrôlables par mission; aucune allowlist implicite. Presets lecture seule, workspace et full access sont visibles; full access est le défaut. Les risques et confirmations d'actions sensibles sont explicites. |
| FR-16 | Fiabilité et lisibilité | Reprise après crash des missions, files et pipelines. Notifications uniquement dans l'application. La vue Efficacité est secondaire et orientée décision : temps, tokens, coût estimé, cache et résultat accepté. |

## Après V1

- Routeurs conditionnels de pipeline.
- Templates de pipeline, après stabilisation du pipeline simple.
- Profils réutilisables de managers.
- Briefing génératif dédié, sous réserve de réévaluation. V1 consulte uniquement l'historique neuf créé dans Nodra; aucun import ni historique DevFlow.
- Toute réintégration de `PortfolioCockpit`, `DecisionQueue`, `AgentWorkspace`, `HandoffCard` ou autre capacité MVP non branchée, seulement après un parcours V1 justifié.

## Rejeté

- Import, migration ou rétrocompatibilité des données, routes et fichiers historiques du MVP.
- Comptes, rôles, organisation, multi-tenant, collaboration temps réel, SaaS et notifications hors application en V1.
- Routeurs et templates dans le pipeline V1.
- Changement automatique de provider, fallback silencieux ou simulation d'une capacité absente.

## Exigences de qualité visibles

**DEC-V** — Conserver l'identité visuelle et la structure générale actuelles sans redesign gratuit, avec interface simple par défaut et détails techniques progressifs. Les parcours critiques respectent WCAG 2.1 AA. Les critères principaux de réussite sont fiabilité, compréhension immédiate de l'état et maintenabilité.

## Décisions techniques encore nécessaires

Voir le registre : uniquement le contrat de preuve, la faisabilité provider, la persistance transactionnelle, la sécurité MCP/permissions et la portabilité/packaging restent à trancher avant architecture détaillée.
