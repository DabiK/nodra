# Référence I6 — Codex app-server (Context7)

Date : 26 juillet 2026. Cette note est une aide d'implémentation pour I6, pas un contrat métier : le contrat Nodra reste `04-providers-permissions.md`. Source Context7 résolue : `/openai/codex`, issue du README app-server OpenAI. Complément officiel : <https://learn.chatgpt.com/docs/app-server>.

## Transport et handshake

- Utiliser `codex app-server` sur **stdio** : une requête JSON-RPC par ligne JSONL. Ne pas parser la sortie d'un CLI ni employer WebSocket, qui est expérimental.
- Envoyer exactement une requête `initialize` après ouverture du transport, puis la notification `initialized`. Toute requête antérieure est rejetée.
- Identifier Nodra dans `clientInfo`; ne demander `experimentalApi` que pour une capacité explicitement nécessaire et isolée.
- Les schémas changent avec la version Codex. Le serveur peut générer les artefacts compatibles : `codex app-server generate-ts --out …` ou `generate-json-schema --out …`. I6 doit conserver la version observée du binaire/capacités avec le probe et ne jamais deviner un champ.

## Séquence nominale

1. Probe explicite : démarrer le processus, handshake, `account/read` et `model/list`, puis arrêter. Le probe ne crée ni thread ni turn.
2. Pour une mission : `thread/start` avec la configuration résolue, ou `thread/resume` avec l'identifiant externe Nodra déjà persisté.
3. Envoyer `turn/start` avec `threadId` et l'input textuel. Les overrides de modèle, `cwd` et sandbox/permissions appartiennent à l'adaptateur et doivent venir du snapshot de run.
4. Consommer les notifications jusqu'à `turn/completed`. Persister les événements Nodra dans l'ordre; `item/completed` est l'état final autoritatif d'un item.
5. Annuler uniquement par `turn/interrupt`; reprendre seulement par `thread/resume` de la session externe connue; `turn/steer` est disponible pour un tour actif.

## Échanges JSONL de référence

Ces extraits sont des messages indépendants, une ligne JSON chacun sur stdin/stdout. Les IDs numériques sont des IDs RPC du client et doivent être corrélés; `thr_*` et `turn_*` sont les références externes à persister, jamais des identifiants Nodra.

```json
{"method":"initialize","id":1,"params":{"clientInfo":{"name":"nodra","title":"Nodra","version":"0.1.0"}}}
{"method":"initialized","params":{}}
{"method":"model/list","id":2,"params":{}}
{"method":"thread/start","id":3,"params":{"model":"<model-from-probe>","cwd":"<canonical-workspace>"}}
{"id":3,"result":{"thread":{"id":"thr_123"}}}
```

Un tour ne reçoit pas une chaîne brute : son `input` est un tableau discriminé. I6 n'envoie que la variante texte tant que les entrées fichier/image/audio ne sont pas réellement supportées et testées.

```json
{"method":"turn/start","id":4,"params":{"threadId":"thr_123","clientUserMessageId":"<nodra-message-id>","input":[{"type":"text","text":"<effective-prompt>"}],"cwd":"<canonical-workspace>","model":"<model-from-run-snapshot>","effort":"medium"}}
{"id":4,"result":{"turn":{"id":"turn_456","status":"inProgress","items":[],"error":null}}}
```

```json
{"method":"turn/steer","id":5,"params":{"threadId":"thr_123","expectedTurnId":"turn_456","clientUserMessageId":"<nodra-message-id>","input":[{"type":"text","text":"<steer-text>"}]}}
{"method":"turn/interrupt","id":6,"params":{"threadId":"thr_123","turnId":"turn_456"}}
{"method":"thread/resume","id":7,"params":{"threadId":"thr_123","excludeTurns":true}}
```

Les notifications à fixture sont au minimum `turn/started`, `item/started`, `item/agentMessage/delta`, `item/completed` et `turn/completed`. La conclusion d'un run vient de `turn/completed` (`completed`, `interrupted` ou `failed`) et non de la simple fermeture du processus.

## Événements et données à conserver

- Notifications de base : `turn/started`, `item/started`, `item/completed`, `item/agentMessage/delta`, `turn/completed`.
- `turn/completed` indique notamment `completed`, `interrupted` ou `failed`. Une erreur doit devenir un résultat/provider event explicite, jamais un succès implicite.
- `model/list` expose le modèle, les efforts de raisonnement supportés, valeur par défaut et modalités d'entrée. Ne rendre disponible qu'une valeur réellement renvoyée par le binaire.
- L'usage ne doit être persisté que lorsqu'un payload le rapporte réellement (`turn/completed`/événement documenté); sinon `usage:none` reste visible.
- Les items peuvent représenter messages, commandes, changements de fichiers et appels MCP. Les logs/preuves Nodra doivent appliquer la politique de redaction existante : aucun token, secret ni valeur d'environnement.

## Permissions, MCP et pièces jointes

- `item/permissions/requestApproval` est une **requête serveur → client** JSON-RPC. Elle inclut thread, turn, item, `cwd`, raison et sous-ensemble de permissions demandé.
- I6 doit traduire cette requête en confirmation Nodra exacte, afficher la cible/risk, et répondre au serveur seulement après décision humaine. Ne jamais répondre par une approbation générale ou persistante sans une nouvelle confirmation Nodra compatible.
- MCP, pièces jointes, options avancées et permissions par profil sont capability-gated. Si la forme app-server exacte n'est pas validée par un fixture et la version probée, déclarer la capability indisponible avec raison; ne pas créer de fallback ou de fausse prise en charge.

### Réponse à une demande de permission

Une requête serveur `item/permissions/requestApproval` porte un `id` RPC : l'adaptateur doit créer la confirmation Nodra, attendre la décision humaine, puis répondre sur le même `id` uniquement avec le sous-ensemble autorisé. Une décision humaine refusée, expirée ou incompatible doit répondre au serveur avec un sous-ensemble vide/refus selon le schéma de la version probée; elle ne doit jamais être transformée en `acceptForSession`.

```json
{"method":"item/permissions/requestApproval","id":61,"params":{"threadId":"thr_123","turnId":"turn_456","itemId":"item_1","cwd":"<canonical-workspace>","reason":"…","permissions":{"fileSystem":{"write":["<path>"]}}}}
{"id":61,"result":{"scope":"turn","permissions":{"fileSystem":{"write":["<approved-subset>"]}}}}
```

Les variantes historiques `commandExecution/requestApproval` et `fileChange/requestApproval` ont des décisions propres (`accept`, `decline`, etc.). Elles ne sont pas un raccourci : les activer seulement après un fixture correspondant et un mapping confirmation Nodra exact.

## Tests attendus

- Fixture JSONL : handshake et ordre des requêtes, modèle, nouveau thread, reprise, stream d'items, succès, erreur, interruption et steer.
- Tests négatifs : JSON malformé, réponse corrélée inconnue, fermeture de processus, notification inattendue, capability absente et aucune auto-approbation.
- Le seul test qui appelle un vrai `codex app-server` est opt-in. La suite standard ne dépend ni d'un login Codex, ni d'une consommation de tokens.

## Forme certifiée par I6

La première version certifiée par l'adaptateur I6 est exactement
`codex_cli_rs/0.145.0`, valeur retournée par `initialize`. Les types stables ont
été générés localement avec `codex app-server generate-ts --out <temp>` depuis
le paquet `codex-cli 0.145.0`; ils ne sont pas recopiés dans le domaine Nodra.
Les fixtures versionnées de l'adaptateur couvrent les formes retenues.

- `ThreadStartParams` et `ThreadResumeParams` acceptent `approvalPolicy:
  "on-request"`, `approvalsReviewer: "user"` et `sandbox:
  "read-only"|"workspace-write"|"danger-full-access"`.
- I6 envoie `approvalsReviewer: "user"` afin qu'une demande reste une décision
  humaine Nodra; les valeurs générées `auto_review` et `guardian_subagent` ne
  sont jamais sélectionnées.
- Le schéma `ThreadResumeParams` généré par 0.145.0 ne contient pas
  `excludeTurns`, contrairement à l'exemple Context7 ci-dessus. I6 omet donc ce
  champ. Une future version différente reste utilisable comme
  `compatible_unverified` si les invariants consommés passent; elle devra être
  exportée et recertifiée pour redevenir `certified`.
- Les décisions stables observées pour les anciennes demandes commande/fichier
  incluent `accept` et `decline`. I6 ne renvoie jamais `acceptForSession`.
- `thread/tokenUsage/updated` possède une fixture de projection, mais le probe
  volontairement sans tour ne peut pas en prouver l'émission réelle. Le
  catalogue publie donc `usage: none` avec la raison
  `usage_not_observed_by_explicit_probe`; un run ne passe à `reported` que lors
  de la réception effective d'un payload valide.
- Pièces jointes et liaison MCP restent indisponibles avec une raison explicite,
  faute de forme 0.145.0 probée et couverte de bout en bout.

Politique de compatibilité : une propriété optionnelle ajoutée, une
notification inconnue ou un nouveau modèle ne bloque pas. I6 conserve ces
notifications comme événements et valide seulement le consumer contract
effectivement utilisé. Une rupture de ce contrat devient
`protocol_incompatible`; le run échoue, le health passe `incompatible` et les
nouveaux starts Codex sont refusés. Le diff structurel automatique complet des
schémas exportés est hors I6 et prévu pour I6.1.
