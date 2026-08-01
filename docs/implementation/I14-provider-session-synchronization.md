# I14 — Synchronisation des sessions provider

**Statut :** I14.2A lots 1 et 2 implémentés ; snapshot Codex déterministe,
identités/liens SQLite et façades application disponibles. API, UI et
observation live externe restent à réaliser, cette dernière sous gate POC.

## Objectif

Faire du provider la source de vérité du contenu conversationnel : messages,
items, ordre et statut des tours. Nodra reste la source de vérité de son métier :
missions, validations humaines, permissions, audit, workflows et liens vers les
sessions externes.

Une session Codex ou OpenCode peut être observée sans avoir été créée par une
mission Nodra. Lorsqu'un autre client provider écrit dans une session liée, la
vue Nodra doit converger vers l'historique provider, sans déduplication par
texte ni reconstruction d'un chat concurrent.

## Contexte

Aujourd'hui, `SqliteProviderRunStore` persiste les notifications provider dans
`provider_event`, puis projette certains messages assistant dans
`conversation_item`. L'UI fusionne ensuite ces deux sources et les déduplique
heuristiquement. La projection est incomplète : steers, prompts de mission,
outils et deltas ne forment pas une histoire canonique.

Les dépendances actuelles à migrer sont :

- `packages/application/src/provider-port.ts` : seulement
  `execute/cancel/steer`, sans lecture d'historique ;
- `packages/adapters/src/codex/codex-provider-adapter.ts` : démarre ou reprend
  un thread et lit les notifications, sans `thread/list/read` ;
- `packages/adapters/src/opencode/opencode-provider-adapter.ts` : lit les
  messages à l'idle, mais ne conserve que le dernier assistant ;
- `packages/adapters/src/sqlite/sqlite-provider-run-store.ts` : journalise les
  événements et écrit la projection `conversation_item` ;
- API/UI/CLI : `agent-session.controller.ts`, `manager.controller.ts`,
  `conversation-cli.ts`, `manager-cli.ts` et le normaliseur web ;
- consommations métier : résultat terminal de mission, résumé manager et
  handover pipeline.

## État d'implémentation

- [x] Port provider-neutral `ProviderSessionSyncPort` et modèles de capability,
  pagination, snapshot, tours, items et événements.
- [x] Adapter Codex séparé pour `thread/list` et
  `thread/read(includeTurns: true)` avec validation, ordre stable, redaction et
  fermeture du client.
- [x] Fixtures JSONL et tests déterministes list/read, payload invalide,
  capability indisponible et référence d'un autre provider.
- [x] Identités provider et liens mission read-only persistés avec unicité,
  attachement et création de mission agent `READY` atomiques et idempotents.
- [x] Registry de synchronisation et façades application list/show,
  capabilities, attach et create-active ; chaque lecture de contenu repart du
  provider et les erreurs Codex sont traduites en erreurs provider-neutral.
- [ ] POC réel Codex A/B : création indépendante, mise à jour concurrente,
  reconnexion et absence de perte silencieuse.
- [ ] API snapshot, page web, CLI, puis SSE après validation du POC.

La capability Codex `listSessions/readSession` reste
`compatible_unverified`. `readHistory`, `subscribe`, reprise par curseur et
contrôle attaché restent explicitement `unavailable`. Aucun résultat du test
déterministe ne certifie l'observation live d'un thread modifié par un autre
client.

## Décisions à figer

| Sujet | Décision proposée |
| --- | --- |
| Vérité des messages | Provider uniquement ; SQLite est un cache synchronisé et un journal redacted |
| Vérité métier | SQLite/Nodra : mission, run, permission, gate, audit et workflow |
| Sessions externes | Attachables explicitement, lecture seule par défaut |
| Contrôle d'une session attachée | Interdit sans ownership Nodra ou capability certifiée + consentement |
| Événements navigateur | SSE Nodra rejouable depuis SQLite, jamais une connexion provider exposée au navigateur |
| Fallback | Aucun parsing de CLI, aucune capacité supposée, absence explicitement visible |
| Migration | Additive, dual-read avant retrait de `conversation_item`, aucune migration historique DevFlow |

Le cache Nodra ne peut jamais fabriquer un item absent du provider. Une erreur de
sync ne peut pas faire réussir une mission, accepter une gate ou répondre à une
permission.

## Décisions produit figées pour le premier parcours web

- Une session provider possède au maximum **une mission active attachée**.
  Une mission peut en revanche regrouper plusieurs sessions provider.
- Attacher une session ne transfère jamais son historique vers
  `conversation_item` et ne donne aucun droit de contrôle sur le processus
  provider.
- « Nouvelle mission » relit le snapshot Codex puis crée atomiquement une
  mission agent `READY`, sa configuration complète et son lien read-only. Le
  cwd de session est canonicalisé et conservé tel quel dans un workspace `repo`
  réutilisé ou créé dans la même transaction.
- Le modèle par défaut provient du dernier catalogue provider persisté. Cette
  création ne crée ni run, relay, ni conversation, ne démarre pas Temporal et
  n'envoie aucun message à Codex.
- La première interface fournit un bouton `Rafraîchir`. Aucun polling global,
  faux live ou `EventSource` n'est ajouté avant le POC concurrent.

## Modèle cible

```text
Codex app-server / OpenCode API + SSE
                │ snapshot, liste, événements
                ▼
Adapter provider (mapping et redaction confinés)
                ▼
ProviderSessionSyncPort → SQLite cache/journal → SSE Nodra
                │                                    │
                ▼                                    ▼
missions/managers (lien facultatif)                UI / CLI
```

Ajouter un port application séparé afin de ne pas surcharger `ProviderPort` :

```ts
interface ProviderSessionSyncPort {
  capabilities(): Promise<ProviderSessionSyncCapabilities>;
  listSessions(query: ProviderSessionListQuery): Promise<ProviderSessionPage>;
  readSession(ref: ProviderSessionRef): Promise<ProviderSessionSnapshot>;
  readHistory(query: ProviderHistoryQuery): Promise<ProviderHistoryPage>;
  subscribe(input: ProviderSubscription): AsyncIterable<ProviderSessionEvent>;
}
```

Les modèles application ne contiennent que provider ID, références externes
opaques, IDs stables d'items, rôle, ordre, timestamps source/réception et
curseur opaque. Les noms `thread/*`, `turn/*`, `session/*` et les payloads
bruts restent dans les adapters.

### Tables proposées

| Table | Finalité | Invariant |
| --- | --- | --- |
| `provider_session` | session externe connue | `(provider_id, external_session_ref)` unique, ownership explicite |
| `provider_session_link` | lien métier read-only | une session a au plus un lien mission actif ; une mission accepte N sessions |
| `provider_history_item` | cache normalisé éventuel | différé jusqu'au POC ; aucun message stocké dans le premier parcours |
| `provider_session_sync` | checkpoint éventuel | différé jusqu'au POC live/cursor |

Le premier parcours bout-en-bout ne crée donc que les deux premières tables.
`provider_session` conserve identité, provider, référence opaque et ownership,
pas le titre, le cwd ni les messages canoniques. La liste et le snapshot restent
lus directement via `ProviderSessionSyncPort`.

`provider_event` est conservé : journal technique par run et source de replay
SSE local. Sa séquence locale ne doit pas être confondue avec le curseur externe
provider. `conversation_item` reste provisoirement une projection legacy.

## Capability matrix à prouver

| Capacité | Codex | OpenCode stable v1 | Décision avant preuve |
| --- | --- | --- | --- |
| liste/découverte | POC requis | SDK disponible, POC requis | unavailable |
| snapshot historique | POC requis | messages disponible, POC requis | unavailable |
| observation live externe | POC requis | SSE global filtré, POC requis | unavailable |
| reprise avec curseur | POC requis | non certifié | unavailable |
| contrôle attaché | POC requis | POC requis | interdit |

Les seuls états exposables sont `certified`, `compatible_unverified` et
`unavailable`, avec raison/action. OpenCode v2 ne devient pas une dépendance
certifiée sans probe serveur réel.

## I14.0 — POC Codex bloquant

Créer un harness isolé dans `poc/provider-session-sync/`, sans migration de
production ni mission. Il utilise un workspace et un data root temporaires.

### Scénario central

1. Client Codex A indépendant : créer un thread et un tour.
2. Client Nodra B : lister puis lire ce thread sans démarrer de tour.
3. Attacher le thread à B en lecture seule ; vérifier IDs, contenu et ordre.
4. Envoyer un nouveau tour ou steer depuis A.
5. Vérifier que B observe les nouveaux items et mesurer la reconnexion.
6. Fermer/réouvrir B ; vérifier replay par curseur ou snapshot complet
   idempotent si le protocole ne fournit pas de curseur.

### Cas d'acceptation

- thread non chargé, actif, idle, archivé et inconnu ;
- ordre stable des user/agent/reasoning/outils et `item/completed` final ;
- doublon, événement tardif, snapshot plus récent que le stream ;
- crash Nodra avant persistance de session ou de run ref ;
- reprise, steer, cancel et permission en attente après redémarrage ;
- issue distante inconnue après arrêt processus : `UNKNOWN` ou décision
  humaine, jamais succès inféré ;
- dérive de version/contrat app-server.

Le POC ne passe que si l'identité durable, l'ordre, le snapshot complet et une
stratégie sans perte silencieuse sont réellement prouvés. Sinon I14 se limite
aux sessions gérées par Nodra et l'observation externe reste indisponible.

Réutiliser les fixtures JSONL Codex, le test adapter et l'export de schéma
existant. Le test réel I7 actuel ne prouve qu'un tour terminal réussi ; il ne
prouve ni concurrence entre clients ni crash/reprise.

## Découpage d'implémentation

### I14.1 — Fondations de synchronisation

- Ajouter types application, `ProviderSessionSyncPort`, capability matrix et
  erreurs provider-neutral.
- Implémenter lecture Codex uniquement après I14.0 ; promouvoir OpenCode de la
  lecture du dernier assistant vers l'historique complet.
- Créer migrations Drizzle pour les quatre tables proposées.
- Conserver `conversation_item` et les contrats API existants.

**Sortie :** snapshot idempotent d'une session Nodra-managed, sans UI nouvelle.

### I14.2 — Attachement, API, CLI et SSE

- Ajouter discovery et attach read-only avec consentement, provider, cwd et
  ownership visibles.
- Synchroniser à l'ouverture, à l'idle, après reconnexion et sur demande ; pas
  de boucle coûteuse hors session observée.
- Ajouter `GET /api/provider-sessions`, attach/show/sync et
  `GET /api/provider-sessions/:id/events` SSE avec `Last-Event-ID`.
- Ajouter CLI list/attach/show/sync/events --follow.

**Sortie :** une session externe certifiée est observable en API/CLI live.

### I14.2A — Parcours web snapshot et attachement

Cette tranche précède le SSE afin de disposer d'un parcours testable de bout en
bout sans simuler une capacité live.

#### Lot 1 — Identité et liens SQLite

- Ajouter `provider_session` avec ID Nodra interne, `provider_id`, référence
  externe opaque, ownership `external_observed|nodra_managed`, timestamps et
  unicité `(provider_id, external_session_ref)`.
- Ajouter `provider_session_link` avec mission, mode `read_only`, timestamps
  d'attachement/détachement et unicité d'un lien mission actif par session.
- Indexer les recherches par session et par mission ; pas de cascade destructive
  sur mission soft-deleted.
- Ajouter repository, migration Drizzle additive, vérification FK/checksum et
  tests d'idempotence/conflit.

#### Lot 2 — Registry et use cases application

- Ajouter un registry `ProviderSessionSyncPort` distinct de `ProviderRegistry`.
- Ajouter les façades `ListProviderSessions`, `ShowProviderSession`,
  `AttachProviderSession` et `CreateActiveMissionForProviderSession`.
- Enrichir list/show avec le lien mission sans modifier le snapshot provider.
- Mapper les erreurs adapter vers des erreurs application stables ; ne jamais
  laisser `CodexProtocolError` devenir un HTTP 500 brut.
- Exiger un `commandId` stable sur les mutations. Attach existant et
  create+attach sont idempotents.
- `CreateActiveMissionForProviderSession` crée la mission humaine, applique
  `prepare` puis `pickup`, écrit relay/audit/outbox et le lien dans une seule
  transaction SQLite. Un échec ne laisse ni mission orpheline ni lien partiel.

#### Lot 3 — API snapshot

```text
GET  /api/provider-sessions/capabilities?providerId=codex
GET  /api/provider-sessions?providerId=codex&limit=40&cursor=<opaque>
GET  /api/provider-sessions/:id
POST /api/provider-sessions/:id/refresh
POST /api/provider-sessions/:id/attach
     { missionId, commandId, mode: "read_only" }
POST /api/provider-sessions/:id/missions
     { title, projectId?, commandId, mode: "read_only" }
```

La liste renvoie un ID interne utilisable dans les URLs, la référence provider
opaque, le résumé live du provider et zéro ou un lien mission actif. Le détail
renvoie snapshot, capability et lien. La commande `refresh` relit le provider ;
elle ne persiste aucun item conversationnel.

Les DTO bornent `limit` à `1..100`, conservent le curseur opaque et utilisent la
validation globale stricte. Attach read-only est déjà une action utilisateur
explicite ; les confirmations fortes restent réservées au futur contrôle
cancel/steer/approval.

#### Lot 4 — Page React

- Ajouter `?page=provider-sessions&session=<provider_session.id>` au shell et
  l'entrée « Sessions Codex » à la sidebar.
- Créer types, service API, hooks avec `AbortController`/génération de requête
  et reducer indexé par IDs provider.
- Créer une liste avec recherche, état, cwd et badge mission ; un détail avec
  historique direct et bouton `Rafraîchir` ; un dialogue « mission existante »
  ou « nouvelle mission ».
- Préremplir le titre de la nouvelle mission depuis le résumé provider mais le
  laisser éditable avant soumission.
- Afficher explicitement `Snapshot · lecture seule`,
  `compatible_unverified` et `Live indisponible`.
- Ne jamais importer `agent-conversation-normalizer` : deux items distincts de
  même texte restent distincts.

#### Lot 5 — Validation bout-en-bout

1. Ouvrir la page et lister les sessions Codex sans créer de thread/tour.
2. Sélectionner une session et vérifier ordre/IDs/rôles du snapshot.
3. Attacher à une mission existante ; vérifier le badge et l'unicité du lien.
4. Créer une nouvelle mission depuis une autre session ; vérifier mission
   humaine `ACTIVE`, relay actif, absence de run/config/conversation et lien
   atomique.
5. Ajouter un message depuis un terminal Codex indépendant, cliquer
   `Rafraîchir` et vérifier l'apparition du nouvel item sans doublon textuel.
6. Recharger la page et vérifier restauration du lien par ID interne.
7. Tester provider indisponible, session disparue, double-submit, conflit de
   lien et retry avec le même `commandId`.

#### Répartition recommandée

| Lot | Complexité | Agent |
| --- | --- | --- |
| Schéma, migration, repository et transaction composée | élevée | Sol medium |
| Registry, use cases et mapping d'erreurs | élevée | Sol medium |
| Contrôleur/DTO/tests HTTP | moyenne | Sol medium |
| Services, reducer et hooks frontend | moyenne | Sol medium |
| Page, dialogue et tests composants | élevée | Sol medium avec revue parent |
| Inventaires, fixtures et triage de sorties | bornée/répétitive | Luna worker |
| E2E réel et arbitrage live | élevée/ambiguë | parent + Sol medium |

Chaque lot suit un seam public TDD : repository/link, use case, HTTP, service ou
composant. Le parent revoit les invariants, les transactions, les erreurs et la
composition finale avant de passer au lot suivant.

### I14.3 — Vue web et liens métier

- Ajouter destination « Sessions providers » indépendante des missions.
- Snapshot initial, `EventSource`, replay, reconnect et fallback snapshot.
- Lier facultativement mission/manager à une session existante.
- Rendre les items synchronisés directement ; retirer la déduplication par
  texte du normaliseur.

**Sortie :** une modification externe apparaît sans polling complet du chat.

### Cartographie frontend actuelle

Le shell web route aujourd'hui `tasks`, `pipelines` et `managers` via le query
parameter `page`. `AgentPage` reste une page autonome ouverte par
`/agent.html?threadId=...`. Il n'existe ni destination provider, ni
`EventSource`, ni client SSE.

Les rafraîchissements reposent sur trois pollings : shell toutes les deux
secondes, session agent toutes les 1,5 seconde et thread manager toutes les
1,8 seconde. `AgentSessionView` et `ManagerThreadView` lisent encore
`conversation_item` et `provider_event`. Le normaliseur fusionne ces sources,
puis déduplique avec une signature issue du type et du texte ; cette étape ne
doit pas être réutilisée pour les items provider canoniques.

Après disponibilité du contrat API/SSE, le frontend devra ajouter :

1. les types provider session, un service snapshot/list/attach/sync et un
   reducer indexé par références provider stables ;
2. un hook qui charge le snapshot, ouvre uniquement le stream de la session
   observée, ferme l'ancien stream et protège les changements rapides de
   sélection avec annulation ou génération ;
3. une destination `provider-sessions` dans le shell et la sidebar, avec liste,
   détail read-only, capability et état `live/degraded/unavailable` visibles ;
4. un rendu direct des tours/items, sans déduplication textuelle ; deux items
   distincts de même texte doivent rester distincts ;
5. une reprise SSE idempotente par ID d'événement Nodra. Cet ID reste distinct
   du curseur provider opaque ; un gap ou `cursor_invalidated` force un nouveau
   snapshot borné.

Les tests web devront couvrir snapshot initial, application d'upserts par ID,
deux items de texte identique, cleanup `EventSource`, reconnexion, fallback
snapshot, changement de session et capability live indisponible. Le polling
global ne doit jamais commencer à lister les sessions provider lorsque cette
destination n'est pas active.

### I14.4 — Migration des consommateurs métier

- Ajouter `ProviderHistoryReader` et migrer terminal mission, handovers,
  résumé manager, API, CLI et tests.
- Dual-read instrumenté : comparer projection legacy et history sync, sans
  changer un résultat métier lors d'un désaccord.
- Définir l'alerte de divergence et son traitement humain.

**Sortie :** aucun consommateur métier ne lit `conversation_item`.

### I14.5 — Retrait legacy

- Arrêter l'écriture de `conversation_item`, retirer le fallback puis supprimer
  table/exports/tests dans une migration dédiée.
- Supprimer ou redesigner séparément `conversation_queue` et
  `conversation_attachment`, qui sont aujourd'hui du schéma sans consommateur
  runtime.
- Vérifier les migrations avec `foreign_key_check` et la validation DDL.

## Synchronisation, recovery et sécurité

Pour chaque page/événement provider : normaliser/redacter dans l'adapter,
écrire item et checkpoint dans une transaction SQLite, puis publier SSE après
commit. Un gap ou curseur rejeté met le sync en `degraded` et force un
snapshot borné ; il ne modifie jamais silencieusement une mission.

L'attachement est lecture seule par défaut. Les actions cancel/steer/approval
nécessitent ownership compatible, capability certifiée et consentement. Nodra
ne tue jamais un processus provider externe pendant reconciliation. Les métriques
ne contiennent pas de contenu : lag, durée, gaps, erreurs, items ajoutés et
connexions SSE uniquement.

## Matrice de tests

| Niveau | Obligatoire |
| --- | --- |
| Adapter | liste, read, snapshot, stream, ordre, doublon, payload inconnu, redaction, version incompatible |
| SQLite | clé item provider, item+curseur transactionnels, replay, gap, FK |
| Application | capability absente, read-only, consentement, aucun effet métier de sync |
| API/SSE | pagination, 404/422, `Last-Event-ID`, heartbeat, reconnect, payload redacted |
| Web | snapshot, EventSource, cleanup, reconnexion, changement session/run, aucune déduplication textuelle |
| Temporal | crash après observation, worker restart, issue ambiguë, contrôles sur run stale/terminal |
| Réel opt-in | Codex A indépendant + Nodra B ; OpenCode seulement après capability certifiée |

Validation de chaque incrément :

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Les tests provider réels restent hors CI par défaut :

```bash
NODRA_TEST_REAL_CODEX_PROBE=1 npx vitest run packages/adapters/src/codex/codex-provider-adapter.test.ts
NODRA_TEST_REAL_CODEX_TURN=1 npx vitest run apps/cli/src/provider-smoke-real.test.ts
NODRA_I7_PROVIDER=codex NODRA_TEST_REAL_CODEX_I7=1 npm run test:e2e:i7:codex
```

## Hors périmètre

- import/migration d'historique DevFlow ou MVP ;
- SaaS, multi-utilisateur et accès provider distant ;
- parsing de sortie CLI ;
- contrôle automatique des sessions externes ;
- nouvelles capacités MCP/attachments/queue/usage sans preuve ;
- suppression de `conversation_item` avant I14.4.

## Documentation à mettre à jour après le POC

Créer ADR-018 sur ownership, cache non canonique et curseurs, puis mettre à jour
`04-providers-permissions.md`, `05-consistency.md`, `06-api-ui-cli.md`,
`07-operations-tests.md`, `08-traceability.md` et `09-backlog.md`.

## Implementation log

- 2026-08-01 — Ticket créé après cartographie des adapters Codex/OpenCode,
  SQLite, API/UI/CLI, fixtures et tests. Aucun code de production, migration ou
  capacité provider n'est modifié ou certifié par ce document.
- 2026-08-01 — I14.1 démarré : contrat application et adapter Codex snapshot
  séparé ajoutés en TDD. Tests ciblés, typecheck, lint et build passent. Le test
  global passe 217 tests mais conserve trois échecs préexistants/hors slice :
  boundary multi-classes et deux scénarios Temporal `WORKFLOW_NOT_FOUND`.
- 2026-08-01 — Smoke réel local read-only réussi sur le Codex installé :
  `thread/list` puis `thread/read` sur une session existante, sans création de
  thread/tour et sans journaliser contenu ni identifiant. Cela ne valide pas
  encore le scénario concurrent A/B ni la reprise live.
- 2026-08-01 — Cartographie frontend ajoutée : routes shell, pollings,
  normaliseur legacy, absence de SSE et seam de tests pour la future page
  `provider-sessions`.
