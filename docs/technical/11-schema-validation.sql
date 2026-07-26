-- Validation documentaire du baseline V1, sans application ni POC.
-- Préparer /tmp/nodra-schema.sql depuis le bloc SQL de 02-domain-sqlite.md,
-- puis exécuter dans le même processus :
--   cat /tmp/nodra-schema.sql docs/technical/11-schema-validation.sql | sqlite3 :memory:

PRAGMA foreign_keys=ON;

INSERT INTO app_config VALUES(1,'global prompt',1,'2026-07-21T00:00:00Z','2026-07-21T00:00:00Z');
INSERT INTO retention_policy VALUES(1,0,'2026-07-21T00:00:00Z','2026-07-21T00:00:00Z');
INSERT INTO blob VALUES('b1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','blobs/aa/b1','text/plain',3,'2026-07-21T00:00:00Z',NULL);
INSERT INTO workspace VALUES('ws',NULL,'scratch','/tmp/ws','ready','2026-07-21T00:00:00Z',NULL);
INSERT INTO repository VALUES('repo1','local:/tmp/nodra-repo',NULL,'/tmp/nodra-repo','/tmp/nodra-repo','2026-07-21T00:00:00Z',NULL);
INSERT INTO workspace VALUES('ws1',NULL,'worktree','/tmp/nodra-worktree','ready','2026-07-21T00:00:00Z',NULL);
INSERT INTO workspace_repository VALUES('ws1','repo1','main','head1','nodra/i5','main',NULL);
INSERT INTO mission VALUES('mh',NULL,'todo','human','DRAFT',0,NULL,'2026-07-21T00:00:00Z','2026-07-21T00:00:00Z',NULL);
INSERT INTO mission VALUES('ma',NULL,'agent','agent','READY',0,'mission/ma','2026-07-21T00:00:00Z','2026-07-21T00:00:00Z',NULL);
INSERT INTO mission_agent_config VALUES('ma','codex','gpt-5','medium',1,'{}','fix','full_access',NULL,0,NULL,'2026-07-21T00:00:00Z');
INSERT INTO mission_input_attachment VALUES('ma',0,'b1','input.txt');
INSERT INTO conversation VALUES('cm','ma',NULL,'codex',NULL,'open','2026-07-21T00:00:00Z',NULL);
INSERT INTO run(id,mission_id,manager_id,conversation_id,user_attempt,state,temporal_workflow_id,provider_id,model_id,reasoning_effort,created_at) VALUES('rm','ma',NULL,'cm',1,'QUEUED','run/rm','codex','gpt-5','medium','2026-07-21T00:00:00Z');
INSERT INTO run_config_snapshot VALUES('rm',1,'codex','codex','gpt-5','gpt-5','medium','medium',1,'{}','{}','mission',1,'fix',NULL,NULL,'fix',NULL,'full_access','{}',NULL,'/tmp','head','tree','2026-07-21T00:00:00Z');
INSERT INTO run_input_snapshot_attachment VALUES('rm',0,'b1','input.txt');

INSERT INTO manager VALUES('mgr',NULL,'draft','manager/mgr','codex','gpt-5','medium',1,'{}','full_access',NULL,'2026-07-21T00:00:00Z',NULL);
INSERT INTO manager_instruction_version VALUES('mgr',1,'manager instruction',1,'2026-07-21T00:00:00Z');
INSERT INTO manager_brief VALUES('mb','mgr',1,'brief','current','2026-07-21T00:00:00Z');
INSERT INTO conversation VALUES('cg',NULL,'mgr','codex',NULL,'open','2026-07-21T00:00:00Z',NULL);
INSERT INTO run(id,mission_id,manager_id,conversation_id,user_attempt,state,temporal_workflow_id,provider_id,model_id,reasoning_effort,created_at) VALUES('rg',NULL,'mgr','cg',1,'QUEUED','run/rg','codex','gpt-5','medium','2026-07-21T00:00:00Z');
INSERT INTO run_config_snapshot VALUES('rg',1,'codex','codex','gpt-5','gpt-5','medium','medium',1,'{}','{}','manager',1,'global prompt\nmanager instruction\nbrief','global prompt','manager instruction',NULL,'brief','full_access','{}',NULL,'/tmp',NULL,NULL,'2026-07-21T00:00:00Z');

INSERT INTO pipeline VALUES('ps',NULL,'scratch pipeline','draft','2026-07-21T00:00:00Z',NULL,NULL);
INSERT INTO pipeline_definition VALUES('pd','ps',1,'published','2026-07-21T00:00:00Z');
INSERT INTO pipeline_node VALUES('pn','pd','ma','node-a','human');
INSERT INTO pipeline_run VALUES('pr','ps','pd','queued','pipeline/pr',NULL,NULL,'2026-07-21T00:00:00Z');
INSERT INTO pipeline_node_run VALUES('pnr','pr','pn','ma','pending',1);
INSERT INTO gate_definition VALUES('gd','tests','collector','1',1,'{}','{}','2026-07-21T00:00:00Z');
INSERT INTO gate_binding VALUES('gb','gd',NULL,'pn',NULL);
INSERT INTO evidence VALUES('ev','rm','observation','digest','collector','1','{}','2026-07-21T00:00:00Z');
INSERT INTO evidence_blob VALUES('ev','b1','report');
INSERT INTO gate_evaluation VALUES('ge','gb','rm','collector','1','passed','2026-07-21T00:00:00Z',NULL,'ok');
INSERT INTO gate_evaluation_evidence VALUES('ge','ev','required');
INSERT INTO confirmation VALUES('cf','workspace.delete','{"workspaceId":"ws"}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','/tmp/ws',NULL,NULL,'destructive','once',NULL,NULL,'ws','2027-07-21T00:00:00Z','approved','user','reviewed','2026-07-21T00:00:00Z','2026-07-21T00:00:00Z',NULL);
INSERT INTO budget_window VALUES('bw-global','global',NULL,'week','confirmable',100,NULL,'2026-07-21T00:00:00Z',NULL);
INSERT INTO budget_window VALUES('bw-mission','mission','ma','mission_lifetime','confirmable',20,NULL,'2026-07-21T00:00:00Z',NULL);
INSERT INTO confirmation VALUES('cf-worktree-delete','workspace.delete','{"workspaceId":"ws1","path":"/tmp/nodra-worktree"}','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','/tmp/nodra-worktree',NULL,'workspace','destructive','once',NULL,NULL,'ws1','2026-07-21T01:00:00Z','approved','user','reviewed','2026-07-21T00:00:00Z','2026-07-21T00:01:00Z',NULL);

INSERT INTO conversation_item VALUES('ci','cm',1,'user','acknowledged','hello',NULL,'2026-07-21T00:00:00Z','2026-07-21T00:00:00Z');
INSERT INTO conversation VALUES('cm-opencode','ma',NULL,'opencode',NULL,'open','2026-07-21T00:00:00Z',NULL);
-- Le changement manuel de provider conserve ci/ cm et ouvre cm-opencode : aucun transfert d'items.

PRAGMA foreign_key_check;
PRAGMA foreign_key_list(run);
PRAGMA foreign_key_list(conversation);
PRAGMA foreign_key_list(pipeline_node);
PRAGMA foreign_key_list(pipeline_run);
SELECT 'mission_human' AS scenario, id FROM mission WHERE id='mh';
SELECT 'mission_agent_snapshot' AS scenario, run_id FROM run_config_snapshot WHERE run_id='rm';
SELECT 'manager_conversation_run' AS scenario, r.id FROM run r JOIN conversation c ON c.id=r.conversation_id WHERE r.id='rg' AND c.manager_id='mgr';
SELECT 'pipeline_scratch' AS scenario, id FROM pipeline WHERE id='ps' AND project_id IS NULL;
SELECT 'gate_proof' AS scenario, e.id FROM gate_evaluation e JOIN gate_evaluation_evidence x ON x.evaluation_id=e.id WHERE e.id='ge';
SELECT 'blob_attachment' AS scenario, blob_id FROM mission_input_attachment WHERE mission_id='ma';
SELECT 'provider_change_new_conversation' AS scenario, id FROM conversation WHERE id='cm-opencode' AND provider_id='opencode';
SELECT 'budget_v1_windows' AS scenario, count(*) FROM budget_window WHERE enforcement='confirmable' AND hard_limit_units IS NULL;
SELECT 'confirmation_exact_workspace_once' AS scenario, id FROM confirmation WHERE id='cf-worktree-delete' AND scope='once' AND workspace_id='ws1' AND state='approved';
SELECT 'confirmation_indexes' AS scenario, count(*) FROM sqlite_master WHERE type='index' AND name IN('idx_confirmation_state_expires','idx_confirmation_run','idx_confirmation_mission','idx_confirmation_workspace');
SELECT 'confirmation_guards' AS scenario, count(*) FROM sqlite_master WHERE type='trigger' AND name IN('confirmation_exact_fields_immutable','confirmation_state_transition');
SELECT 'retention_v1_no_auto_purge' AS scenario, automatic_purge_enabled FROM retention_policy WHERE id=1;
