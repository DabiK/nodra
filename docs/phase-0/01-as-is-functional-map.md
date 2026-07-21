# Cartographie fonctionnelle AS-IS

## Portée et niveau de preuve

Référence : MVP au commit `475ae382bb5a19cc889c79ab6d19b592d730a105`, inspecté le 2026-07-21. Cette cartographie couvre les comportements et contrats utiles au cadrage; elle n'est pas un inventaire exhaustif des routes.

Preuves principales : README, roadmap, navigation React, contrats TypeScript, routes Fastify, tests API/DOM et probe runtime non mutante (`health` et `providers`). L'inspection visuelle interactive n'était pas disponible; les trois captures du README ont seulement valeur d'intention illustrée.

## Promesse et acteur

- **OBS** — DevFlow se présente comme un cockpit local pour piloter plusieurs agents sans multiplier les terminaux et rendre visibles tâches, handovers, preuves et décisions humaines (`api-v2/README.md:4-5`, `api-v2/README.md:39-49`).
- **DEC-V** — La cible reste local-first et mono-utilisateur. Comptes, rôles, multi-tenant, collaboration temps réel et SaaS sont hors périmètre.
- **OBS** — Le shell UI expose six surfaces : Vue d'ensemble, Tâches, Pipelines, Managers, Supervision et Efficacité (`api-v2/apps/web/src/App.tsx:39-47`, `:468-523`).

## Parcours observés

| ID | Capacité / parcours | État AS-IS et preuve | Confiance |
| --- | --- | --- | --- |
| CAP-01 | Voir le travail utile | La home classe tâches et pipelines en aujourd'hui, en cours et attente humaine selon dates et statuts (`TaskRelay.tsx:28-74`). | Haute, code + tests |
| CAP-02 | Créer et configurer une mission | Titre, dépôt/workspace, prompt, provider, modèle, réflexion, MCP, pièces jointes, échéance et critères de réussite sont exposés par les contrats et l'UI (`README.md:91-105`, `App.tsx:437-441`, `packages/contracts/src/index.ts:448-515`). | Haute |
| CAP-03 | Inspecter puis lancer explicitement | L'inspecteur et le configurateur sont distincts; la roadmap pose explicitement qu'inspecter ne lance jamais (`product-roadmap.md:7-13`, `App.tsx:527-735`). | Moyenne à haute; parcours complet à revalider visuellement |
| CAP-04 | Suivre une exécution | Une tâche référence provider, session, run, statut, timestamps, dernier message, erreur, queue et handover (`packages/contracts/src/index.ts:116-142`, `:268-313`, `:448-515`). | Haute |
| CAP-05 | Poursuivre une conversation | Queue, steer, reprise, arrêt et historique existent dans les contrats/API; la disponibilité dépend du provider (`README.md:97-102`, `apps/api/src/app.ts:1085-1154`). | Haute côté contrat, variable côté provider |
| CAP-06 | Distinguer résultat, preuve et décision | Delivery, checks, rapport agent, DoD, waivers et revue humaine sont séparés (`packages/contracts/src/index.ts:143-205`, `:268-313`; `README.md:43-49`). | Haute |
| CAP-07 | Enchaîner ponctuellement | Les dépendances et handovers permettent une séquence unique, distincte d'un workflow réutilisable (`README.md:63-83`). | Haute |
| CAP-08 | Composer un pipeline | DAG, auto-start, gates, templates, routeurs, archivage, reprise et snapshots sont présents (`packages/contracts/src/index.ts:516-578`; tests `WorkflowFeature.chat.test.tsx`). | Haute, mais surface dense |
| CAP-09 | Utiliser un manager meta-agent | Un manager persistant possède instruction, configuration agent et conversations; il pilote via la CLI (`README.md:57-61`; `apps/api/test/api.test.ts:23-41`). | Haute |
| CAP-10 | Gérer projets et politiques | Entité Project, objectif, branche d'intégration, DoD et politique d'exécution existent (`packages/contracts/src/index.ts:345-358`). | Haute côté domaine/API |
| CAP-11 | Isoler et livrer par Git | Modes repository, scratch et worktree, inspection de diff, review, intégration et nettoyage existent (`packages/contracts/src/index.ts:359-447`; `README.md:124-134`). | Haute; risque opérationnel à analyser plus tard |
| CAP-12 | Attirer l'attention humaine | Une file d'attention et une supervision existent, avec états vu/reporté/résolu (`packages/contracts/src/index.ts:769-813`; `App.tsx:513-521`). | Haute côté contrat; place produit à arbitrer |
| CAP-13 | Mesurer coûts et efficacité | La vue Efficacité agrège usage, couverture tarifaire et résultats (`README.md:85-101`; `App.tsx:523`). | Moyenne; qualité des données variable par provider |
| CAP-14 | Générer et consulter des briefings | Un panneau distinct charge l'historique et génère explicitement un briefing; stockage séparé de l'état tâche (`App.tsx:526`; routes `apps/api/src/app.ts:171-205`). | Haute |
| CAP-15 | Choisir un provider selon ses capacités | Le contrat expose disponibilité, maturité, capacités et raison d'indisponibilité (`packages/contracts/src/index.ts:33-74`). Le probe local a retourné Codex stable et Copilot preview, avec usage absent pour Copilot. | Haute, constat runtime daté |

## Concepts métier à conserver, sans reprendre les structures du MVP

`OBS` — Les concepts fonctionnels centraux sont : projet, mission/tâche, manager, session, run, message/instruction, provider et modèle, workspace, workflow/template/nœud/route, handover, gate, preuve de livraison, décision humaine, attention, briefing et mesure d'usage.

`DEC-V` — Leur conservation éventuelle porte sur leur sens et leurs parcours, pas sur les fichiers JSON, identifiants, routes, champs `codex*` historiques ni migrations internes du MVP.

## Divergences et limites

- **OBS** — La roadmap qualifie de « livrés » un dashboard par dépôt et une file globale (`product-roadmap.md:15-32`). Un composant `PortfolioCockpit` existe, mais il n'est pas importé dans le shell actuel; la navigation réelle branche `TaskRelay` sur la home (`App.tsx:1-23`, `:468-486`). Il faut donc distinguer code présent, surface accessible et intention.
- **OBS** — Des noms `codex*` persistent dans le contrat générique Task alors que `agentProvider` peut être Codex ou Copilot (`packages/contracts/src/index.ts:448-515`). Ils ne prouvent pas une frontière provider-neutral propre.
- **OBS** — La documentation demande une migration historique dans ses scénarios (`product-roadmap.md:93-95`), désormais explicitement rejetée pour la cible.
- **Q** — La hiérarchie produit entre Relais, portefeuille par projet et file d'attention n'est pas tranchée.
- **Q** — La couverture E2E des gestes destructifs Git, de la reprise après crash et de l'accessibilité visuelle n'a pas été auditée dans ce jalon.
