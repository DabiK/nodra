# 01 — Architecture système, modules et états

## C4

```mermaid
C4Context
title Nodra V1
Person(user, "Développeur solo")
System(nodra, "Nodra", "Application locale")
System_Ext(codex, "Codex app-server", "JSON-RPC local")
System_Ext(copilot, "Copilot SDK/CLI", "SDK officiel")
System_Ext(mcp, "MCP", "Tous les serveurs configurés")
Rel(user, nodra, "UI web ou CLI")
Rel(nodra, codex, "provider adapter")
Rel(nodra, copilot, "provider adapter")
Rel(codex, mcp, "outils")
Rel(copilot, mcp, "outils")
```

```mermaid
C4Container
title Nodra local
Container(cli, "CLI", "Node", "installe/supervise/ouvre")
Container(ui, "UI", "React/Vite", "Relais et décision")
Container(api, "API", "NestJS + Express", "use cases + SSE")
Container(worker, "Worker", "Temporal TypeScript", "Activities providers/Git")
ContainerDb(db, "Nodra SQLite", "SQLite", "vérité métier")
ContainerDb(temporal, "Temporal self-host", "runtime", "historiques et commandes")
Container(art, "data/artifacts", "filesystem", "logs immuables et blobs")
Rel(cli, api, "démarre")
Rel(ui, api, "REST/SSE")
Rel(api, db, "transactions")
Rel(api, temporal, "start/signal/update/query")
Rel(worker, temporal, "poll task queues")
Rel(worker, db, "Activities idempotentes")
Rel(worker, art, "écrit artefacts")
```

## Modules hexagonaux

| Module | Responsabilité | Dépendances autorisées |
| --- | --- | --- |
| `domain` | agrégats, invariants, state machines, événements métier | zéro framework/I/O |
| `application` | use cases, transactions, authorisation, ports | domain + ports |
| `adapters/in` | Nest REST/SSE, CLI | application uniquement |
| `adapters/out/sqlite` | repositories, outbox, schema Drizzle, migrations générées | ports + Drizzle + driver SQLite |
| `adapters/out/temporal` | client/worker/workflow | ports + SDK Temporal |
| `adapters/out/providers` | Codex app-server, Copilot SDK | ports + SDK/protocole |
| `adapters/out/git,fs,process` | Git, worktree, observations, artefacts | ports + OS |

Les Workflows Temporal ne contiennent pas d'I/O ni de règle métier persistée. Ils attendent, coordonnent et appellent des Activities; toute écriture SQLite, provider, Git ou fichier est une Activity idempotente.

Drizzle ORM est confiné à `adapters/out/sqlite`. Son schéma TypeScript strict est la source d'implémentation; domaine et application n'importent ni Drizzle ni types SQL. Les repositories traduisent ports ↔ Drizzle. Le SQL manuel est réservé aux PRAGMA/bootstrap, FTS5, triggers, contraintes et index SQLite que Drizzle ne représente pas correctement; il est versionné, revu et couvert par le contrat DDL de [02-domain-sqlite.md](02-domain-sqlite.md).

## Interfaces normatives

```ts
type Id = string & { readonly brand: unique symbol };
type MissionState = 'DRAFT'|'READY'|'ACTIVE'|'BLOCKED'|'VALIDATION'|'DONE'|'ABANDONED';
type RunState = 'QUEUED'|'STARTING'|'RUNNING'|'WAITING_APPROVAL'|'CANCELLING'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'UNKNOWN';
interface CommandContext { commandId: Id; actor: 'user'|'manager'; occurredAt: string; }
interface MissionRepository { load(id: Id): Promise<Mission>; save(m: Mission, expectedVersion: number): Promise<void>; }
interface WorkflowPort { start(input: StartMissionInput): Promise<{workflowId:string; runId:string}>; signal(id:string, signal: WorkflowSignal): Promise<void>; update<T>(id:string, update:WorkflowUpdate): Promise<T>; query<T>(id:string, q:WorkflowQuery): Promise<T>; }
interface ProviderPort { capabilities(): Promise<ProviderCapabilities>; start(input: ProviderStart): Promise<ProviderRef>; events(ref:ProviderRef): AsyncIterable<ProviderEvent>; steer(ref:ProviderRef, text:string, mode:'immediate'|'enqueue'): Promise<void>; cancel(ref:ProviderRef): Promise<void>; resume(ref:ProviderRef): Promise<ProviderRef>; }
```

## Machines à états

```mermaid
stateDiagram-v2
[*] --> DRAFT
DRAFT --> READY: configure/ready
READY --> ACTIVE: start explicite
DRAFT --> DONE: close human
READY --> DONE: close human
ACTIVE --> BLOCKED: dependency|provider|budget
ACTIVE --> VALIDATION: run succeeded + gate evidence
BLOCKED --> READY: unblock
VALIDATION --> DONE: accept
VALIDATION --> READY: request correction
DRAFT --> ABANDONED
READY --> ABANDONED
BLOCKED --> ABANDONED
```

Invariants : aucun lancement à la lecture; `DONE` agent nécessite acceptation; `ACTIVE` implique au plus un run actif par mission; une dépendance non satisfaite interdit le start; une suppression exige confirmation et cible exacte.
