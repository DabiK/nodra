# 02 — Baseline SQLite V1 cohérent

Nodra démarre sur une base vierge : le bloc ci-dessous est **le schéma initial V1 unique**, pas une migration du MVP ni une succession `0001/0003`. Les migrations Nodra commencent seulement après ce baseline et sont enregistrées dans `schema_migration`. SQLite est ouvert avec `PRAGMA foreign_keys=ON`, WAL et transactions courtes.

Le schéma TypeScript strict **Drizzle** est la source primaire d'implémentation de tables, colonnes, relations et migrations générées. Ce DDL exhaustif est le contrat normatif et l'artefact de validation, non le SQL exécuté directement par les use cases. Les exceptions SQL ciblées (FTS5, triggers, index d'expression, contraintes/PRAGMA) accompagnent la migration Drizzle concernée, avec justification et test de drift.

## Règles de modélisation

- `mission` ne contient que `human|agent`; `manager` est un agrégat distinct.
- Conversation et run ont deux FK explicites (`mission_id`, `manager_id`) avec `CHECK` exactement-un; les triggers garantissent que run et conversation portent le même sujet.
- Une tentative utilisateur crée un nouveau `run` et snapshot; un retry technique reste dans le même run et est historisé par Temporal/événements. `MissionWorkflow` ou `ManagerWorkflow` est parent; chaque `RunWorkflow` child a `run/<runId>`.
- Un blob content-addressed est indépendant. Les entrées lient un `blob`; une preuve lie un blob de sortie via `evidence_blob`; un artefact est une vue typée d'un blob, jamais le parent obligatoire d'une entrée.
- Les JSON sont limités aux charges versionnées non requêtées; provider, modèle, reasoning, états, sujets, usage et coûts ont des colonnes.

## DDL exécutable initial

```sql
PRAGMA foreign_keys=ON;

CREATE TABLE schema_migration(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL);
CREATE TABLE app_config(id INTEGER PRIMARY KEY CHECK(id=1), global_manager_prompt TEXT NOT NULL DEFAULT '', prompt_composition_schema_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE repository(id TEXT PRIMARY KEY, stable_identity TEXT NOT NULL UNIQUE, canonical_remote TEXT, initial_path TEXT NOT NULL, current_path TEXT NOT NULL, discovered_at TEXT NOT NULL, moved_at TEXT);
CREATE TABLE project(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('repo','scratch')), name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE project_repository(project_id TEXT PRIMARY KEY REFERENCES project(id), repository_id TEXT NOT NULL UNIQUE REFERENCES repository(id));
CREATE TABLE project_agent_defaults(project_id TEXT PRIMARY KEY REFERENCES project(id), provider_id TEXT, model_id TEXT, reasoning_effort TEXT, provider_options_schema_version INTEGER NOT NULL DEFAULT 1, provider_options_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(provider_options_json)), permission_preset TEXT NOT NULL DEFAULT 'full_access' CHECK(permission_preset IN('read_only','workspace','full_access')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE blob(id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256)=64), relative_path TEXT NOT NULL UNIQUE, mime_type TEXT, byte_size INTEGER NOT NULL CHECK(byte_size>=0), created_at TEXT NOT NULL, tombstoned_at TEXT);
CREATE TABLE workspace(id TEXT PRIMARY KEY, project_id TEXT REFERENCES project(id), kind TEXT NOT NULL CHECK(kind IN('repo','scratch','worktree')), path TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN('ready','in_use','pending_delete','deleted')), created_at TEXT NOT NULL, tombstoned_at TEXT);
CREATE TABLE workspace_repository(workspace_id TEXT PRIMARY KEY REFERENCES workspace(id), repository_id TEXT NOT NULL REFERENCES repository(id), base_ref TEXT, head_ref TEXT, branch_name TEXT, integration_target_ref TEXT, tombstoned_at TEXT);
CREATE TABLE workspace_git_snapshot(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id), reason TEXT NOT NULL, head TEXT, tree_digest TEXT, branch_name TEXT, captured_at TEXT NOT NULL);

CREATE TABLE mission(id TEXT PRIMARY KEY, project_id TEXT REFERENCES project(id), title TEXT NOT NULL CHECK(length(trim(title))>0), execution_kind TEXT NOT NULL CHECK(execution_kind IN('human','agent')), state TEXT NOT NULL CHECK(state IN('DRAFT','READY','ACTIVE','BLOCKED','VALIDATION','DONE','ABANDONED')), version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0), temporal_parent_workflow_id TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE mission_agent_config(mission_id TEXT PRIMARY KEY REFERENCES mission(id), provider_id TEXT, model_id TEXT, reasoning_effort TEXT, provider_options_schema_version INTEGER NOT NULL DEFAULT 1, provider_options_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(provider_options_json)), mission_prompt TEXT NOT NULL DEFAULT '', permission_preset TEXT CHECK(permission_preset IN('read_only','workspace','full_access')), workspace_id TEXT REFERENCES workspace(id), auto_commit_authorized INTEGER NOT NULL DEFAULT 0 CHECK(auto_commit_authorized IN(0,1)), integration_target_ref TEXT, updated_at TEXT NOT NULL);
CREATE TABLE mission_input_attachment(mission_id TEXT NOT NULL REFERENCES mission(id), ordinal INTEGER NOT NULL CHECK(ordinal>=0), blob_id TEXT NOT NULL REFERENCES blob(id), display_name TEXT NOT NULL, PRIMARY KEY(mission_id,ordinal));

CREATE TABLE manager(id TEXT PRIMARY KEY, project_id TEXT REFERENCES project(id), state TEXT NOT NULL CHECK(state IN('draft','ready','active','blocked','archived')), temporal_parent_workflow_id TEXT UNIQUE, provider_id TEXT, model_id TEXT, reasoning_effort TEXT, provider_options_schema_version INTEGER NOT NULL DEFAULT 1, provider_options_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(provider_options_json)), permission_preset TEXT NOT NULL DEFAULT 'full_access' CHECK(permission_preset IN('read_only','workspace','full_access')), workspace_id TEXT REFERENCES workspace(id), created_at TEXT NOT NULL, archived_at TEXT);
CREATE TABLE manager_instruction_version(manager_id TEXT NOT NULL REFERENCES manager(id), version INTEGER NOT NULL, instruction TEXT NOT NULL, is_current INTEGER NOT NULL CHECK(is_current IN(0,1)), created_at TEXT NOT NULL, PRIMARY KEY(manager_id,version));
CREATE UNIQUE INDEX ux_manager_current_instruction ON manager_instruction_version(manager_id) WHERE is_current=1;
CREATE TABLE manager_brief(id TEXT PRIMARY KEY, manager_id TEXT NOT NULL REFERENCES manager(id), version INTEGER NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('current','superseded')), created_at TEXT NOT NULL, UNIQUE(manager_id,version));
CREATE TABLE manager_input_attachment(manager_id TEXT NOT NULL REFERENCES manager(id), ordinal INTEGER NOT NULL CHECK(ordinal>=0), blob_id TEXT NOT NULL REFERENCES blob(id), display_name TEXT NOT NULL, PRIMARY KEY(manager_id,ordinal));
CREATE TABLE pipeline(id TEXT PRIMARY KEY, project_id TEXT REFERENCES project(id), name TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('draft','active','completed','archived')), created_at TEXT NOT NULL, completed_at TEXT, archived_at TEXT);
CREATE TABLE manager_supervision(id TEXT PRIMARY KEY, manager_id TEXT NOT NULL REFERENCES manager(id), mission_id TEXT REFERENCES mission(id), pipeline_id TEXT REFERENCES pipeline(id), relation TEXT NOT NULL CHECK(relation IN('created','supervises')), created_at TEXT NOT NULL, CHECK((mission_id IS NOT NULL AND pipeline_id IS NULL) OR (mission_id IS NULL AND pipeline_id IS NOT NULL)));
CREATE TABLE manager_creation_request(id TEXT PRIMARY KEY, parent_manager_id TEXT NOT NULL REFERENCES manager(id), child_manager_id TEXT REFERENCES manager(id), approval_id TEXT REFERENCES approval(id), state TEXT NOT NULL CHECK(state IN('pending','approved','denied','created')), created_at TEXT NOT NULL);

CREATE TABLE conversation(id TEXT PRIMARY KEY, mission_id TEXT REFERENCES mission(id), manager_id TEXT REFERENCES manager(id), provider_id TEXT NOT NULL, provider_session_ref TEXT, state TEXT NOT NULL CHECK(state IN('open','idle','closed','deleted')), created_at TEXT NOT NULL, deleted_at TEXT, CHECK((mission_id IS NOT NULL AND manager_id IS NULL) OR (mission_id IS NULL AND manager_id IS NOT NULL)));
CREATE TABLE conversation_item(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id), ordinal INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN('user','assistant','tool','system','steer','result')), delivery_state TEXT NOT NULL CHECK(delivery_state IN('draft','queued','sent','acknowledged','failed','cancelled')), body TEXT, provider_item_ref TEXT, created_at TEXT NOT NULL, acknowledged_at TEXT, UNIQUE(conversation_id,ordinal));
CREATE TABLE conversation_queue(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id), item_id TEXT NOT NULL UNIQUE REFERENCES conversation_item(id), mode TEXT NOT NULL CHECK(mode IN('immediate','enqueue')), state TEXT NOT NULL CHECK(state IN('queued','dispatched','acknowledged','failed','cancelled')), created_at TEXT NOT NULL, dispatched_at TEXT);
CREATE TABLE conversation_attachment(conversation_item_id TEXT NOT NULL REFERENCES conversation_item(id), blob_id TEXT NOT NULL REFERENCES blob(id), ordinal INTEGER NOT NULL, PRIMARY KEY(conversation_item_id,ordinal));

CREATE TABLE run(id TEXT PRIMARY KEY, mission_id TEXT REFERENCES mission(id), manager_id TEXT REFERENCES manager(id), conversation_id TEXT NOT NULL REFERENCES conversation(id), user_attempt INTEGER NOT NULL CHECK(user_attempt>0), state TEXT NOT NULL CHECK(state IN('QUEUED','STARTING','RUNNING','WAITING_APPROVAL','CANCELLING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN')), temporal_workflow_id TEXT NOT NULL UNIQUE, temporal_run_id TEXT, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, reasoning_effort TEXT, provider_run_ref TEXT, started_at TEXT, ended_at TEXT, duration_ms INTEGER CHECK(duration_ms>=0), input_tokens INTEGER CHECK(input_tokens>=0), output_tokens INTEGER CHECK(output_tokens>=0), cache_read_tokens INTEGER CHECK(cache_read_tokens>=0), cache_write_tokens INTEGER CHECK(cache_write_tokens>=0), cost_micros INTEGER CHECK(cost_micros>=0), usage_kind TEXT CHECK(usage_kind IN('reported','estimated','unavailable')), pricing_snapshot_json TEXT CHECK(pricing_snapshot_json IS NULL OR json_valid(pricing_snapshot_json)), created_at TEXT NOT NULL, CHECK((mission_id IS NOT NULL AND manager_id IS NULL) OR (mission_id IS NULL AND manager_id IS NOT NULL)), UNIQUE(mission_id,user_attempt), UNIQUE(manager_id,user_attempt));
CREATE TABLE run_config_snapshot(run_id TEXT PRIMARY KEY REFERENCES run(id), resolution_schema_version INTEGER NOT NULL, provider_id_requested TEXT NOT NULL, provider_id_resolved TEXT NOT NULL, model_id_requested TEXT, model_id_resolved TEXT NOT NULL, reasoning_effort_requested TEXT, reasoning_effort_resolved TEXT, provider_options_schema_version INTEGER NOT NULL, provider_options_json TEXT NOT NULL CHECK(json_valid(provider_options_json)), provider_capabilities_json TEXT NOT NULL CHECK(json_valid(provider_capabilities_json)), prompt_kind TEXT NOT NULL CHECK(prompt_kind IN('mission','manager')), prompt_composition_schema_version INTEGER NOT NULL, prompt_effective TEXT NOT NULL, prompt_global TEXT, prompt_manager_instruction TEXT, prompt_mission TEXT, prompt_brief TEXT, permission_preset TEXT NOT NULL CHECK(permission_preset IN('read_only','workspace','full_access')), budget_snapshot_json TEXT NOT NULL CHECK(json_valid(budget_snapshot_json)), workspace_id TEXT REFERENCES workspace(id), cwd TEXT NOT NULL, git_head TEXT, git_tree TEXT, created_at TEXT NOT NULL);
CREATE TABLE run_snapshot_mcp(run_id TEXT NOT NULL REFERENCES run(id), mcp_id TEXT NOT NULL, config_digest TEXT NOT NULL CHECK(length(config_digest)=64), transport_kind TEXT NOT NULL, PRIMARY KEY(run_id,mcp_id));
CREATE TABLE run_input_snapshot_attachment(run_id TEXT NOT NULL REFERENCES run(id), ordinal INTEGER NOT NULL CHECK(ordinal>=0), blob_id TEXT NOT NULL REFERENCES blob(id), display_name TEXT NOT NULL, PRIMARY KEY(run_id,ordinal));
CREATE TABLE provider_event(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES run(id), sequence INTEGER NOT NULL CHECK(sequence>=0), type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), source_at TEXT, received_at TEXT NOT NULL, UNIQUE(run_id,sequence));

CREATE TABLE pipeline_definition(id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL REFERENCES pipeline(id), version INTEGER NOT NULL, definition_state TEXT NOT NULL CHECK(definition_state IN('draft','published','superseded')), created_at TEXT NOT NULL, UNIQUE(pipeline_id,version));
CREATE TABLE pipeline_node(id TEXT PRIMARY KEY, definition_id TEXT NOT NULL REFERENCES pipeline_definition(id), mission_id TEXT REFERENCES mission(id), node_key TEXT NOT NULL, start_mode TEXT NOT NULL CHECK(start_mode IN('auto','human')), UNIQUE(definition_id,node_key));
CREATE TABLE pipeline_edge(id TEXT PRIMARY KEY, definition_id TEXT NOT NULL REFERENCES pipeline_definition(id), from_node_id TEXT NOT NULL REFERENCES pipeline_node(id), to_node_id TEXT NOT NULL REFERENCES pipeline_node(id), CHECK(from_node_id<>to_node_id), UNIQUE(definition_id,from_node_id,to_node_id));
CREATE TABLE pipeline_run(id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL REFERENCES pipeline(id), definition_id TEXT NOT NULL REFERENCES pipeline_definition(id), state TEXT NOT NULL CHECK(state IN('queued','active','blocked','completed','failed','cancelled','archived')), temporal_workflow_id TEXT UNIQUE, started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE pipeline_node_run(id TEXT PRIMARY KEY, pipeline_run_id TEXT NOT NULL REFERENCES pipeline_run(id), node_id TEXT NOT NULL REFERENCES pipeline_node(id), mission_id TEXT REFERENCES mission(id), state TEXT NOT NULL CHECK(state IN('pending','ready','active','blocked','completed','failed','skipped')), user_attempt INTEGER NOT NULL DEFAULT 1, UNIQUE(pipeline_run_id,node_id,user_attempt));
CREATE TABLE handover(id TEXT PRIMARY KEY, pipeline_node_run_id TEXT NOT NULL REFERENCES pipeline_node_run(id), from_run_id TEXT REFERENCES run(id), to_node_run_id TEXT NOT NULL REFERENCES pipeline_node_run(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL);
CREATE TABLE targeted_retry(id TEXT PRIMARY KEY, pipeline_node_run_id TEXT NOT NULL REFERENCES pipeline_node_run(id), prior_run_id TEXT REFERENCES run(id), new_run_id TEXT REFERENCES run(id), requested_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE gate_definition(id TEXT PRIMARY KEY, name TEXT NOT NULL, evaluator_id TEXT NOT NULL, evaluator_version TEXT NOT NULL, criteria_schema_version INTEGER NOT NULL, criteria_json TEXT NOT NULL CHECK(json_valid(criteria_json)), expected_evidence_json TEXT NOT NULL CHECK(json_valid(expected_evidence_json)), created_at TEXT NOT NULL);
CREATE TABLE gate_binding(id TEXT PRIMARY KEY, gate_id TEXT NOT NULL REFERENCES gate_definition(id), pipeline_edge_id TEXT REFERENCES pipeline_edge(id), pipeline_node_id TEXT REFERENCES pipeline_node(id), mission_id TEXT REFERENCES mission(id), CHECK((pipeline_edge_id IS NOT NULL AND pipeline_node_id IS NULL AND mission_id IS NULL) OR (pipeline_edge_id IS NULL AND pipeline_node_id IS NOT NULL AND mission_id IS NULL) OR (pipeline_edge_id IS NULL AND pipeline_node_id IS NULL AND mission_id IS NOT NULL)));
CREATE TABLE evidence(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES run(id), kind TEXT NOT NULL CHECK(kind IN('declaration','observation','validation')), subject_digest TEXT NOT NULL, collector_id TEXT NOT NULL, collector_version TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL);
CREATE TABLE evidence_blob(evidence_id TEXT NOT NULL REFERENCES evidence(id), blob_id TEXT NOT NULL REFERENCES blob(id), role TEXT NOT NULL CHECK(role IN('stdout','stderr','report','output','other')), PRIMARY KEY(evidence_id,blob_id,role));
CREATE TABLE artifact(id TEXT PRIMARY KEY, blob_id TEXT NOT NULL UNIQUE REFERENCES blob(id), evidence_id TEXT REFERENCES evidence(id), artifact_kind TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE gate_evaluation(id TEXT PRIMARY KEY, gate_binding_id TEXT NOT NULL REFERENCES gate_binding(id), run_id TEXT REFERENCES run(id), evaluator_id TEXT NOT NULL, evaluator_version TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('pending','passed','failed','stale','overridden')), evaluated_at TEXT NOT NULL, stale_at TEXT, rationale TEXT);
CREATE TABLE gate_evaluation_evidence(evaluation_id TEXT NOT NULL REFERENCES gate_evaluation(id), evidence_id TEXT NOT NULL REFERENCES evidence(id), role TEXT NOT NULL, PRIMARY KEY(evaluation_id,evidence_id));
CREATE TABLE approval(id TEXT PRIMARY KEY, run_id TEXT REFERENCES run(id), mission_id TEXT REFERENCES mission(id), manager_id TEXT REFERENCES manager(id), kind TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('pending','approved','denied','expired')), expires_at TEXT, decided_at TEXT, created_at TEXT NOT NULL, CHECK((run_id IS NOT NULL)+(mission_id IS NOT NULL)+(manager_id IS NOT NULL)=1));
CREATE TABLE confirmation(id TEXT PRIMARY KEY, action TEXT NOT NULL, target_json TEXT NOT NULL CHECK(json_valid(target_json)), target_digest TEXT NOT NULL CHECK(length(target_digest)=64), cwd TEXT, provider_id TEXT, permission_preset TEXT CHECK(permission_preset IS NULL OR permission_preset IN('read_only','workspace','full_access')), risk TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN('once','run','mission')), run_id TEXT REFERENCES run(id), mission_id TEXT REFERENCES mission(id), workspace_id TEXT REFERENCES workspace(id), expires_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('pending','approved','denied','expired','consumed')), decided_by TEXT, comment TEXT, created_at TEXT NOT NULL, decided_at TEXT, consumed_at TEXT, CHECK((scope='once' AND ((run_id IS NOT NULL)+(mission_id IS NOT NULL)+(workspace_id IS NOT NULL))=1) OR (scope='run' AND run_id IS NOT NULL AND mission_id IS NULL AND workspace_id IS NULL) OR (scope='mission' AND mission_id IS NOT NULL AND run_id IS NULL AND workspace_id IS NULL)));
CREATE TABLE gate_override(id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL REFERENCES gate_evaluation(id), approval_id TEXT NOT NULL REFERENCES approval(id), decision TEXT NOT NULL CHECK(decision IN('accept','reject','waive')), comment TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE run_delivery(id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES run(id), agent_declaration TEXT, observation_summary TEXT, result_state TEXT NOT NULL CHECK(result_state IN('pending','delivered','accepted','changes_requested','rejected')), accepted_at TEXT, decision_comment TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE mcp_selection(owner_kind TEXT NOT NULL CHECK(owner_kind IN('global','project','mission','manager')), owner_id TEXT NOT NULL, selection_mode TEXT NOT NULL CHECK(selection_mode IN('all','none','custom','inherit')), PRIMARY KEY(owner_kind,owner_id));
CREATE TABLE mcp_selection_member(owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, mcp_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN('enable','disable')), config_digest TEXT CHECK(config_digest IS NULL OR length(config_digest)=64), PRIMARY KEY(owner_kind,owner_id,mcp_id));
CREATE TABLE permission_grant(id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES approval(id), action_kind TEXT NOT NULL, target_digest TEXT NOT NULL CHECK(length(target_digest)=64), scope TEXT NOT NULL CHECK(scope IN('once','run','mission')), run_id TEXT REFERENCES run(id), mission_id TEXT REFERENCES mission(id), expires_at TEXT, decision TEXT NOT NULL CHECK(decision IN('approved','denied')), consumed_at TEXT, consumed_by_event_id TEXT, created_at TEXT NOT NULL, CHECK((scope='once' AND run_id IS NOT NULL AND mission_id IS NULL) OR (scope='run' AND run_id IS NOT NULL AND mission_id IS NULL) OR (scope='mission' AND mission_id IS NOT NULL AND run_id IS NULL)));
CREATE TABLE budget_window(id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN('global','mission')), scope_id TEXT, period TEXT NOT NULL CHECK(period IN('week','mission_lifetime')), enforcement TEXT NOT NULL DEFAULT 'confirmable' CHECK(enforcement IN('confirmable','absolute')), soft_limit_units INTEGER NOT NULL CHECK(soft_limit_units>=0), hard_limit_units INTEGER CHECK(hard_limit_units>=soft_limit_units), active_from TEXT NOT NULL, active_until TEXT, CHECK((scope='global' AND scope_id IS NULL AND period='week') OR (scope='mission' AND scope_id IS NOT NULL AND period='mission_lifetime')), CHECK((enforcement='confirmable' AND hard_limit_units IS NULL) OR enforcement='absolute'));
CREATE UNIQUE INDEX ux_budget_window_scope ON budget_window(scope,COALESCE(scope_id,''),period,active_from);
CREATE TABLE budget_override(id TEXT PRIMARY KEY, budget_window_id TEXT NOT NULL REFERENCES budget_window(id), approval_id TEXT NOT NULL REFERENCES approval(id), units_delta INTEGER NOT NULL, expires_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE concurrency_policy(id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN('global','project','provider')), scope_id TEXT, max_active INTEGER NOT NULL CHECK(max_active>0), CHECK((scope='global' AND scope_id IS NULL) OR (scope IN('project','provider') AND scope_id IS NOT NULL)));
CREATE UNIQUE INDEX ux_concurrency_policy_scope ON concurrency_policy(scope,COALESCE(scope_id,''));
CREATE TABLE concurrency_lease(id TEXT PRIMARY KEY, policy_id TEXT NOT NULL REFERENCES concurrency_policy(id), run_id TEXT NOT NULL UNIQUE REFERENCES run(id), acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL, released_at TEXT);
CREATE TABLE budget_ledger(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES run(id), budget_window_id TEXT REFERENCES budget_window(id), usage_kind TEXT NOT NULL CHECK(usage_kind IN('reported','estimated','unavailable')), units INTEGER NOT NULL CHECK(units>=0), cost_micros INTEGER CHECK(cost_micros>=0), provider_usage_json TEXT NOT NULL CHECK(json_valid(provider_usage_json)), created_at TEXT NOT NULL);
CREATE TABLE relay_item(id TEXT PRIMARY KEY, mission_id TEXT REFERENCES mission(id), pipeline_run_id TEXT REFERENCES pipeline_run(id), queue TEXT NOT NULL CHECK(queue IN('ready','active','blocked','decision_required')), state TEXT NOT NULL CHECK(state IN('unread','read','snoozed','resolved')), reason_code TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, snoozed_until TEXT, resolved_at TEXT, CHECK((mission_id IS NOT NULL AND pipeline_run_id IS NULL) OR (mission_id IS NULL AND pipeline_run_id IS NOT NULL)));
CREATE TABLE business_audit_event(id TEXT PRIMARY KEY, aggregate_kind TEXT NOT NULL, aggregate_id TEXT NOT NULL, command_id TEXT, event_type TEXT NOT NULL, actor TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), occurred_at TEXT NOT NULL);
CREATE TABLE outbox(id TEXT PRIMARY KEY, kind TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, published_at TEXT);
CREATE TABLE inbox(consumer TEXT NOT NULL, message_id TEXT NOT NULL, processed_at TEXT NOT NULL, PRIMARY KEY(consumer,message_id));
CREATE TABLE retention_policy(id INTEGER PRIMARY KEY CHECK(id=1), automatic_purge_enabled INTEGER NOT NULL DEFAULT 0 CHECK(automatic_purge_enabled=0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE retention_tombstone(id TEXT PRIMARY KEY, entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, deleted_at TEXT NOT NULL, restored_at TEXT, purge_requested_at TEXT, purged_at TEXT, purge_state TEXT NOT NULL CHECK(purge_state IN('soft_deleted','restored','purged')));
CREATE TABLE search_document_registry(entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY(entity_kind,entity_id));
CREATE VIRTUAL TABLE search_document USING fts5(entity_kind UNINDEXED,entity_id UNINDEXED,title,body, tokenize='unicode61');

CREATE INDEX idx_mission_relay ON mission(state,updated_at DESC);
CREATE INDEX idx_run_subject ON run(mission_id,manager_id,created_at DESC);
CREATE INDEX idx_run_provider_model ON run(provider_id,model_id,reasoning_effort,created_at DESC);
CREATE INDEX idx_conversation_item ON conversation_item(conversation_id,ordinal);
CREATE INDEX idx_pipeline_definition ON pipeline_definition(pipeline_id,version DESC);
CREATE INDEX idx_gate_evaluation ON gate_evaluation(gate_binding_id,state,evaluated_at DESC);
CREATE INDEX idx_budget_ledger_run ON budget_ledger(run_id,created_at DESC);
CREATE INDEX idx_relay_queue ON relay_item(queue,state,snoozed_until,created_at DESC);
CREATE INDEX idx_audit_aggregate ON business_audit_event(aggregate_kind,aggregate_id,occurred_at DESC);
CREATE INDEX idx_confirmation_state_expires ON confirmation(state,expires_at);
CREATE INDEX idx_confirmation_run ON confirmation(run_id,action,state);
CREATE INDEX idx_confirmation_mission ON confirmation(mission_id,action,state);
CREATE INDEX idx_confirmation_workspace ON confirmation(workspace_id,action,state);

-- Cross-table integrity SQLite cannot express through FK alone.
CREATE TRIGGER run_subject_matches_conversation BEFORE INSERT ON run BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM conversation c WHERE c.id=NEW.conversation_id AND ((NEW.mission_id IS NOT NULL AND c.mission_id=NEW.mission_id AND c.manager_id IS NULL) OR (NEW.manager_id IS NOT NULL AND c.manager_id=NEW.manager_id AND c.mission_id IS NULL))) THEN RAISE(ABORT,'run subject must match conversation subject') END;
END;
CREATE TRIGGER mcp_owner_exists BEFORE INSERT ON mcp_selection BEGIN
  SELECT CASE WHEN NEW.owner_kind='global' AND NEW.owner_id<>'global' THEN RAISE(ABORT,'global MCP owner must be global') WHEN NEW.owner_kind='project' AND NOT EXISTS(SELECT 1 FROM project WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing project MCP owner') WHEN NEW.owner_kind='mission' AND NOT EXISTS(SELECT 1 FROM mission WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing mission MCP owner') WHEN NEW.owner_kind='manager' AND NOT EXISTS(SELECT 1 FROM manager WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing manager MCP owner') END;
END;
CREATE TRIGGER mcp_owner_update_exists BEFORE UPDATE OF owner_kind,owner_id ON mcp_selection BEGIN
  SELECT CASE WHEN NEW.owner_kind='global' AND NEW.owner_id<>'global' THEN RAISE(ABORT,'global MCP owner must be global') WHEN NEW.owner_kind='project' AND NOT EXISTS(SELECT 1 FROM project WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing project MCP owner') WHEN NEW.owner_kind='mission' AND NOT EXISTS(SELECT 1 FROM mission WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing mission MCP owner') WHEN NEW.owner_kind='manager' AND NOT EXISTS(SELECT 1 FROM manager WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing manager MCP owner') END;
END;
CREATE TRIGGER mcp_member_owner_exists BEFORE INSERT ON mcp_selection_member BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mcp_selection s WHERE s.owner_kind=NEW.owner_kind AND s.owner_id=NEW.owner_id) THEN RAISE(ABORT,'missing MCP selection owner') END;
END;
CREATE TRIGGER mcp_member_owner_update_exists BEFORE UPDATE OF owner_kind,owner_id ON mcp_selection_member BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mcp_selection s WHERE s.owner_kind=NEW.owner_kind AND s.owner_id=NEW.owner_id) THEN RAISE(ABORT,'missing MCP selection owner') END;
END;
CREATE TRIGGER published_pipeline_immutable BEFORE UPDATE ON pipeline_definition WHEN OLD.definition_state='published' BEGIN SELECT RAISE(ABORT,'published pipeline definition is immutable'); END;
CREATE TRIGGER published_pipeline_not_deleted BEFORE DELETE ON pipeline_definition WHEN OLD.definition_state='published' BEGIN SELECT RAISE(ABORT,'published pipeline definition is immutable'); END;
CREATE TRIGGER pipeline_edge_same_definition BEFORE INSERT ON pipeline_edge BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pipeline_node n WHERE n.id=NEW.from_node_id AND n.definition_id=NEW.definition_id) OR NOT EXISTS(SELECT 1 FROM pipeline_node n WHERE n.id=NEW.to_node_id AND n.definition_id=NEW.definition_id) THEN RAISE(ABORT,'edge nodes must belong to definition') END;
END;
CREATE TRIGGER pipeline_run_definition_matches BEFORE INSERT ON pipeline_run BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pipeline_definition d WHERE d.id=NEW.definition_id AND d.pipeline_id=NEW.pipeline_id) THEN RAISE(ABORT,'pipeline run definition must belong to pipeline') END;
END;
CREATE TRIGGER pipeline_node_run_definition_matches BEFORE INSERT ON pipeline_node_run BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pipeline_run r JOIN pipeline_node n ON n.id=NEW.node_id WHERE r.id=NEW.pipeline_run_id AND n.definition_id=r.definition_id) THEN RAISE(ABORT,'node must belong to pipeline run definition') END;
END;
CREATE TRIGGER manager_current_instruction_exists BEFORE INSERT ON manager BEGIN
  SELECT CASE WHEN NEW.state IN('ready','active') AND NOT EXISTS(SELECT 1 FROM manager_instruction_version i WHERE i.manager_id=NEW.id AND i.is_current=1) THEN RAISE(ABORT,'ready manager requires current instruction') END;
END;
CREATE TRIGGER manager_ready_requires_instruction BEFORE UPDATE OF state ON manager WHEN NEW.state IN('ready','active') BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM manager_instruction_version i WHERE i.manager_id=NEW.id AND i.is_current=1) THEN RAISE(ABORT,'ready manager requires current instruction') END;
END;
CREATE TRIGGER mission_config_only_for_agent BEFORE INSERT ON mission_agent_config BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mission m WHERE m.id=NEW.mission_id AND m.execution_kind='agent') THEN RAISE(ABORT,'human mission cannot have agent config') END;
END;
CREATE TRIGGER confirmation_exact_fields_immutable BEFORE UPDATE OF action,target_json,target_digest,cwd,provider_id,permission_preset,risk,scope,run_id,mission_id,workspace_id,expires_at,created_at ON confirmation BEGIN
  SELECT RAISE(ABORT,'confirmation exact fields are immutable');
END;
CREATE TRIGGER confirmation_state_transition BEFORE UPDATE OF state ON confirmation WHEN NOT (
  (OLD.state='pending' AND NEW.state IN('approved','denied','expired')) OR
  (OLD.state='approved' AND NEW.state IN('consumed','expired')) OR
  OLD.state=NEW.state
) BEGIN
  SELECT RAISE(ABORT,'invalid confirmation state transition');
END;
CREATE TRIGGER workspace_state_transition BEFORE UPDATE OF state ON workspace WHEN NOT (
  (OLD.state='ready' AND NEW.state IN('ready','in_use','pending_delete')) OR
  (OLD.state='in_use' AND NEW.state IN('in_use','ready')) OR
  (OLD.state='pending_delete' AND NEW.state IN('pending_delete','deleted')) OR
  (OLD.state='deleted' AND NEW.state IN('deleted','ready'))
) BEGIN
  SELECT RAISE(ABORT,'invalid workspace state transition');
END;
```

`search_document_registry` fournit l'unicité que FTS5 ne peut pas imposer : la transaction crée/remplace le document FTS seulement après avoir réservé `(entity_kind,entity_id)`; le delete/tombstone supprime le registre et le document FTS. L'index ne reçoit ni secret, ni options sensibles, ni stdout/stderr/log provider brut.

Le Relais est matérialisé : `ready` = démarrable, `active` = run actif, `blocked` = dépendance/provider/budget, `decision_required` = approval/gate/delivery pending. Une transition métier met à jour son `relay_item` et `business_audit_event` dans la même transaction; l'outbox reste uniquement technique. Le seuil budget bloque le prochain tour provider; une approbation crée `budget_override` borné, auditée et snapshotée dans le run. Aucun hard-cap n'est créé par défaut. Les tombstones sont restaurables; V1 n'a aucune purge automatique, et la purge définitive requiert une seconde confirmation avec cible exacte et vérification qu'un blob n'a plus aucune référence.

`confirmation` est distincte de `approval` : elle autorise une action externe exacte, conserve sa cible canonique et son digest, puis est consommée atomiquement. `approval` reste réservé aux décisions métier, notamment `gate_override`.

## Validation documentaire reproductible

Voir [11-schema-validation.sql](11-schema-validation.sql). Il extrait ce DDL dans SQLite, active les FK, exécute `foreign_key_check` et les scénarios minimaux sans application ni POC.

Chaîne de migration : `schema Drizzle → migration générée → patch SQL ciblé éventuel → SQLite neuve → foreign_key_check/scénarios → comparaison avec le DDL contractuel`. La CI échoue si une migration générée, le baseline Drizzle ou le contrat DDL divergent sans mise à jour revue des trois éléments.
