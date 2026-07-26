# Audit approfondi — décision d’orchestration Nodra

Statut : **analyse corrigée, 2026-07-21**. DevFlow est uniquement le MVP historique; Nodra est la cible. Cette note ne modifie aucune observation historique : elle remplace les citations internes non auditables et les recommandations incompatibles avec les décisions validées.

## Conclusion

**Temporal self-host est retenu comme moteur durable de Nodra**, derrière une frontière hexagonale. Il apporte une exécution reprise après crash, historique, timers, retries, annulation et primitives d’interaction (`Signal`, `Update`, `Query`) déjà éprouvées. Il ne devient ni le domaine, ni Git, ni un provider, ni le moteur de validation humaine. SQLite est la vérité métier; Temporal commande et historise les exécutions. Le protocole de cohérence est dans [technical/05-consistency.md](technical/05-consistency.md).

Ce choix est préférable à un scheduler interne : les sémantiques de reprise, timer, retry, cancellation et historique sont précisément le coût que Nodra ne doit pas réimplémenter. Il est préférable à LangGraph, ADK et MAF comme cœur : ces produits organisent avant tout des graphes/boucles d'agents; ils n'offrent pas le modèle Nodra de mission humaine, gate, preuve, Git/worktree et décision. Cette dernière conclusion est une **inférence d'architecture**, non une prétention que ces frameworks seraient inutiles.

| Candidat | Décision | Raison vérifiable |
| --- | --- | --- |
| Temporal | Retenu | Workflows rejouables, Activities, task queues, Signals/Updates/Queries et versioning de workflow documentés par le [SDK TypeScript](https://docs.temporal.io/develop/typescript) et le [service OSS](https://github.com/temporalio/temporal). |
| LangGraph / Google ADK / Microsoft Agent Framework | Non retenu comme backbone | Leur valeur est la boucle/graph d'agents. Les besoins Nodra restent modélisés dans le domaine et sont appelés depuis Activities; ils peuvent être étudiés dans un adaptateur, jamais imposés au cœur. [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence), [ADK workflows](https://google.github.io/adk-docs/workflows/), [MAF](https://learn.microsoft.com/agent-framework/). |
| Scheduler interne | Non retenu | Dupliquerait durable timers, retries, cancellation, replay et historique sans acheter une capacité produit différenciante. |
| AutoGen | Non retenu sans allégation de maintenance | Aucune affirmation de « maintenance mode » n'est conservée faute de source primaire actuelle. Son exclusion est un fit/stack, pas un jugement de maintenance. [Dépôt officiel](https://github.com/microsoft/autogen). |

## Providers V1

Codex s'intègre au **Codex app-server JSON-RPC**, surface locale dédiée à l'orchestration, et non au CLI parsé. L'adaptateur conserve les identifiants app-server dans son mapping d'infrastructure; le domaine ne connaît que des références provider. Référence : [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

OpenCode s'intègre à son serveur local HTTP/OpenAPI, démarré et supervisé explicitement par Nodra sur loopback, jamais par parsing de sortie CLI. L'adaptateur doit découvrir les modèles et capacités via l'API exposée, consommer les événements SSE et conserver les identifiants de session/runs dans son mapping d'infrastructure. Une POC borne la faisabilité des sessions, streaming, interruption, reprise, steering, usage, pièces jointes et MCP avant de déclarer toute capacité disponible. Référence : [OpenCode Server](https://opencode.ai/docs/server/).

## Temporal local : limite importante

`temporal server start-dev` est un outil de démarrage local/de développement dans le README du service et les exemples; cette source ne le qualifie pas de runtime distribuable de production. Il **ne doit donc pas être empaqueté comme solution de production par présomption**. Le POC doit démontrer une distribution self-host supportable avec persistance durable et cycle de vie multi-OS, sinon l'architecture reste bloquée (sans bascule vers Temporal Cloud). Voir [technical/12-packaging-backup-poc.md](technical/12-packaging-backup-poc.md).

## Sources structurantes

- [Temporal TypeScript — Workflows](https://docs.temporal.io/develop/typescript/core-application)
- [Temporal TypeScript — Activities](https://docs.temporal.io/develop/typescript/core-application#activities)
- [Temporal self-hosting](https://docs.temporal.io/self-hosted-guide)
- [SQLite WAL](https://www.sqlite.org/wal.html) et [transactions](https://www.sqlite.org/lang_transaction.html)
- [NestJS Express](https://docs.nestjs.com/techniques/performance) et [SSE](https://docs.nestjs.com/techniques/server-sent-events)

Les URLs ci-dessus sont les sources primaires à revalider lors du POC; aucune citation de recherche interne n'est utilisée.
