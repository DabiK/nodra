CREATE TRIGGER workspace_state_transition
BEFORE UPDATE OF state ON workspace
WHEN NOT (
  (OLD.state='ready' AND NEW.state IN('ready','in_use','pending_delete')) OR
  (OLD.state='in_use' AND NEW.state IN('in_use','ready')) OR
  (OLD.state='pending_delete' AND NEW.state IN('pending_delete','deleted')) OR
  (OLD.state='deleted' AND NEW.state IN('deleted','ready'))
)
BEGIN
  SELECT RAISE(ABORT,'invalid workspace state transition');
END;
