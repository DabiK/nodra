import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { ConfirmationRequiredError, DomainError } from "@nodra/application";
import { randomUUID } from "node:crypto";

interface HttpRequest {
  body?: unknown;
}

interface HttpResponse {
  status(value: number): HttpResponse;
  type(value: string): HttpResponse;
  json(value: unknown): void;
}

const statusFor = (code: string): number => {
  if (code === "MISSION_NOT_FOUND" || code === "PROJECT_NOT_FOUND") return 404;
  if (
    code === "MISSION_VERSION_CONFLICT" ||
    code === "TRANSITION_FORBIDDEN" ||
    code === "COMMAND_ID_CONFLICT" ||
    code === "MISSION_ALREADY_EXISTS" || code === "EVIDENCE_STALE" || code === "APPROVAL_ALREADY_DECIDED" ||
    code === "DELIVERY_ALREADY_DECIDED" || code === "EVIDENCE_ID_CONFLICT" || code === "GATES_NOT_SATISFIED" ||
    code === "APPROVAL_TARGET_MISMATCH" || code === "APPROVAL_KIND_MISMATCH" || code === "APPROVAL_ALREADY_CONSUMED" ||
    code === "BLOB_DIGEST_MISMATCH"
  ) return 409;
  if (code === "MISSION_TITLE_REQUIRED" || code === "BLOCK_REASON_REQUIRED") return 422;
  if (code === "PERSISTENCE_FAILURE") return 500;
  if (code === "RUNTIME_UNHEALTHY" || code === "WORKFLOW_UNAVAILABLE") return 503;
  if (code === "AGENT_CONFIG_REQUIRED") return 422;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code === "CAPABILITY_UNAVAILABLE") return 422;
  if (code === "GATE_DEFINITION_INVALID") return 422;
  if (code === "APPROVAL_REQUIRED") return 428;
  if (code === "CONFIRMATION_REQUIRED") return 428;
  if (
    code === "CONFIRMATION_EXPIRED" ||
    code === "CONFIRMATION_TARGET_MISMATCH" ||
    code === "CONFIRMATION_ALREADY_CONSUMED" ||
    code === "WORKSPACE_ACTIVE_RUN" ||
    code === "WORKSPACE_PATH_CONFLICT" ||
    code === "WORKSPACE_STATE_CONFLICT"
  ) return 409;
  return 400;
};

@Catch(DomainError)
export class BusinessErrorFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const body = request.body;
    const commandId = isBodyWithCommandId(body) && body.commandId.trim() ? body.commandId : randomUUID();
    const status = statusFor(error.code);
    response.status(status).type("application/problem+json").json({
      type: `https://nodra.local/problems/${error.code.toLowerCase()}`,
      title: error.code,
      status,
      code: error.code,
      detail: error.message,
      commandId,
      ...(error instanceof ConfirmationRequiredError
        ? { confirmation: error.confirmation }
        : {})
    });
  }
}

const isBodyWithCommandId = (value: unknown): value is { commandId: string } =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  "commandId" in value && typeof value.commandId === "string";
