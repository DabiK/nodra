# 04 — Providers, MCP, permissions et Git

## Contrat provider-neutral

```ts
type PermissionPreset = 'read_only' | 'workspace' | 'full_access';
type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'provider_default';
interface ProviderCapabilities { providerId:string; version:string; availability:boolean; models:boolean; start:boolean; events:boolean; cancel:boolean; resume:boolean; queue:boolean; steer:'immediate'|'enqueue'|'none'; usage:'reported'|'estimated'|'none'; attachments:boolean; mcp:boolean; permissionInterception:boolean; optionsSchemaVersion:number; }
interface BaseResolvedConfig { providerId:string; modelId:string; reasoningEffort:ReasoningEffort; providerOptions:{schemaVersion:number; value:unknown}; mcp:McpBinding[]; permission:PermissionPreset; attachments:AttachmentRef[]; budget:BudgetSnapshot; workspace:ResolvedWorkspace; }
interface MissionRunConfig extends BaseResolvedConfig { kind:'mission'; prompt:{effective:string; mission:string}; }
interface ManagerRunConfig extends BaseResolvedConfig { kind:'manager'; prompt:{effective:string; global:string; manager:string; brief:string}; }
type ResolvedRunConfig = MissionRunConfig | ManagerRunConfig;
interface ProviderStart { session?: ProviderRef; config: ResolvedRunConfig; cwd:string; }
type ProviderEvent = {sequence:number; type:string; payload:unknown; occurredAt:string};
```

Chaque capacité est découverte, versionnée et conservée au lancement; UI désactive une action absente en indiquant la raison. `usage:none` n'est jamais remplacé par une valeur inventée; la limite porte alors sur unités configurées/temps, marquées estimées.

### Frontière anti-couplage provider

`mission`, `manager`, `conversation` et `run` ne portent aucun champ nommé d'après un provider (`codexPrompt`, `codexProfile`, etc.). Le domaine connaît seulement un prompt, une sélection `providerId`/`modelId`, un niveau de raisonnement générique et un `providerOptions` versionné/opaque. Le catalogue de profils, la validation du schéma d'options, les identifiants de session et les détails de protocole appartiennent à l'adaptateur du provider et à son snapshot de run, jamais au modèle de tâche mutable. L'ajout ou le retrait d'un provider ne requiert donc ni colonne, ni endpoint, ni règle métier spécifique à ce provider.

## Configuration mutable, résolution et snapshot

Une mission `human` ne possède pas de `mission_agent_config` et ne peut pas lancer de provider. Une mission `agent` a une configuration éditable tant qu'aucun lancement n'est en cours. Un `manager` distinct porte sa propre configuration et ses instructions/briefs versionnés. Une édition n'altère jamais un run existant.

Résolution, sans fallback/changement de provider : (1) défauts de projet; (2) champs non nuls de la configuration mission; (3) overrides explicites et validés de la commande `start`; (4) validation contre les capacités et le schéma d'options du **provider demandé**. `providerId` est choisi par mission ou override explicite uniquement; si le provider/modèle demandé est indisponible, le lancement échoue avec `CAPABILITY_UNAVAILABLE`. Les valeurs héritées portent leur provenance `project|mission|launch`; les MCP se résolvent par union ordonnée des défauts projet puis des lignes mission `enable|disable`, sans allowlist implicite.

La sélection MCP est explicite : `all`, `none`, `custom` ou `inherit`. Sans projet (scratch), `inherit` remonte au défaut global; sinon il remonte au projet puis au global. Un manager applique ensuite sa sélection explicite avant les overrides de mission qu'il crée. `custom` n'active que ses membres `enable`; `all` part du catalogue disponible, et les membres `disable` retirent explicitement un serveur. La résolution est inscrite avec ses digests dans le snapshot.

Le lancement construit en une transaction le `run` et `run_config_snapshot`, puis ses MCP/pièces jointes. Le snapshot contient : valeurs demandées et résolues provider/modèle/reasoning; options avec version du schéma; prompt effectif et composants; capacités/version provider; permissions; MCP et digest de configuration; attachments avec digest; budget; workspace/cwd/Git; versions de schéma. Il ne contient jamais token, clé, valeur d'environnement secrète ou contenu de secret. Les identifiants de références de secret sont redacted et ne sont pas transmis au snapshot.

Pour `manager`, le prompt effectif est exactement `app_config.global_manager_prompt + manager_instruction_version.instruction + manager_brief.content`, dans cet ordre, avec séparateurs et `prompt_composition_schema_version` connus; les trois segments non secrets et le résultat sont conservés dans `run_config_snapshot`. Pour une mission agent simple, `mission_prompt` est le composant et le résultat. La prévisualisation applique la même résolution mais ne crée ni run, ni session ni appel provider.

| Provider | Intégration primaire | POC obligatoire |
| --- | --- | --- |
| Codex | app-server JSON-RPC; process supervisor; mapping de notifications/requests | session/resume, cancel, approval, stream, modèle, pièces jointes, MCP, usage |
| OpenCode | serveur local HTTP/OpenAPI sur loopback, démarré/supervisé explicitement; API events SSE | session/resume, cancel, stream, steer/queue si exposés, modèle, pièces jointes, MCP, usage |

Références : [Codex app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md), [OpenCode Server](https://opencode.ai/docs/server/). Aucun adaptateur provider ne parse la sortie d'un CLI; Copilot CLI/SDK est hors V1.

## Permissions et MCP

MCP est `all available` par défaut : le catalogue de configuration est affiché avant run, la sélection résolue est snapshotée dans `run_config_snapshot`/`run_snapshot_mcp`, et traduite vers l'adaptateur. Full access est le preset initial, jamais une approbation implicite permanente. Les confirmations sont requises pour : écriture/suppression hors workspace, commande réseau ou credentials, Git commit/push/merge/rebase/force, création de manager, dépassement budget, installation/exécution de binaire, arrêt/update runtime, et action dont le provider demande permission. La table `confirmation`, distincte de `approval`, contient action normalisée, cible JSON canonique et digest, cwd, provider, preset, risque, expiration et portée `once|run|mission`; seule une confirmation `approved`, non expirée et à cible/portée exacte peut être consommée atomiquement.

Une confirmation n'est pas une permission large : même avec une portée `run` ou `mission`, elle autorise **une seule** opération dont l'action, la cible canonique, le digest, le `cwd` et le sujet sont identiques à la demande affichée. `once` peut lier exactement un run, une mission ou un workspace; `run` lie seulement un run; `mission` lie seulement une mission. Elle passe de `pending` à `approved|denied|expired`, puis de `approved` à `consumed` une fois; une décision à l'instant d'expiration ou après devient `expired` et ne peut jamais être consommée.

Secrets : Nodra ne persiste ni tokens ni clés. Il transmet uniquement références de secret/environnement aux processus sous contrôle, masque valeurs dans logs et interdit leur stockage dans preuves. Les MCP distants sont explicitement signalés comme exfiltration potentielle.

## Git / workspaces

`WorkspacePort` crée `repo`, `scratch` ou `worktree`. Un worktree est recommandé pour une mission qui modifie un dépôt; path canonique, repo source et HEAD sont enregistrés. Toute intégration Git demande confirmation; auto-commit seulement si autorisé dans la mission. Suppression worktree : état `PENDING_DELETE`, vérification cible exacte et absence de run, confirmation, Activity idempotente, puis tombstone SQLite. Les activités Git produisent snapshots avant/après et digest; elles ne déduisent jamais qu'un changement est accepté.

Règle I5 non ambiguë : créer un workspace ne doit jamais écraser un chemin existant. `mission_agent_config.auto_commit_authorized=true` est une autorisation explicite configurée par l'humain pour cette mission; sans elle, chaque commit exige une confirmation exacte. Une intégration (merge/rebase/cherry-pick/push vers une cible) exige toujours une confirmation exacte, même si l'auto-commit est autorisé. La suppression d'un worktree exige toujours une confirmation `once` liée au workspace, puis crée seulement un tombstone restaurable; aucune purge ni suppression de branche n'est implicite.
