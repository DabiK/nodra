import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { DomainError } from "@nodra/application";
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
    code === "APPROVAL_TARGET_MISMATCH" || code === "BLOB_DIGEST_MISMATCH"
  ) return 409;
  if (code === "MISSION_TITLE_REQUIRED" || code === "BLOCK_REASON_REQUIRED") return 422;
  if (code === "PERSISTENCE_FAILURE") return 500;
  if (code === "RUNTIME_UNHEALTHY" || code === "WORKFLOW_UNAVAILABLE") return 503;
  if (code === "AGENT_CONFIG_REQUIRED") return 422;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code === "CAPABILITY_UNAVAILABLE") return 422;
  if (code === "APPROVAL_REQUIRED") return 428;
  return 400;
};

@Catch(DomainError)
export class BusinessErrorFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const body = request.body as { commandId?: unknown } | undefined;
    const commandId = typeof body?.commandId === "string" && body.commandId.trim() ? body.commandId : randomUUID();
    const status = statusFor(error.code);
    response.status(status).type("application/problem+json").json({
      type: `https://nodra.local/problems/${error.code.toLowerCase()}`,
      title: error.code,
      status,
      code: error.code,
      detail: error.message,
      commandId
    });
  }
}
