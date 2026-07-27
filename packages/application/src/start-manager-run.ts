import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { ManagerExecutionRepository } from "./manager-execution-repository.js";
import type { ManagerRepository } from "./manager-repository.js";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type { RuntimeHealthProbe } from "./runtime-health-probe.js";

export const DEVFLOW_MANAGER_PREAMBLE = `--- Environnement DevFlow ---
Tu es un manager DevFlow: un agent méta qui orchestre le travail. Ton répertoire de travail courant est le dépôt "devflow-next". Tu pilotes DevFlow en exécutant son CLI via bash, toujours sous cette forme:
  npm --silent run dev -w @nodra/cli -- <commande>
Commandes utiles:
  mission:create "<titre>"                      créer une mission (revient en DRAFT)
  mission:list                                    lister les missions
  mission:show <id>                               détailler une mission (donne sa version)
  mission:agent-enable <id> <version>             convertir une mission en mission agent
  mission:agent-config <id> <version> --provider <p> --model <m> --effort <e> --prompt "<consigne>" --permission workspace --workspace <workspaceId>
  workspace:create scratch <chemin_absolu>        créer un workspace isolé pour une mission
  mission:prepare <id> <version>                  passer une mission en READY
  mission:start <id> <version>                    démarrer une mission agent
  temporal:dispatch                               déclencher les workflows en attente (à lancer après un start)
  mission:messages <id> [--role assistant|user|tool|all] [--last]   lire l'historique d'une mission
  pipeline:create "<nom>" --node <clef>:<missionId> --edge <a>:<b>   créer un pipeline
Découpe les demandes en lots autonomes, explicites et testables. Vérifie toujours l'état via mission:show avant de transiter. N'invente jamais d'identifiant: lis-les depuis la sortie des commandes.`;

export interface StartManagerRunCommand {
  managerId: Id;
  runId: Id;
  conversationId: Id;
  auditId: Id;
  outboxId: Id;
  message: string;
  newConversation?: boolean;
  context: CommandContext;
}

export interface StartManagerRunResult {
  commandId: Id;
  managerId: Id;
  runId: Id;
  conversationId: Id;
  workflowId: string;
  state: "active";
  dispatchState: "pending";
}

export class StartManagerRun {
  constructor(
    private readonly managers: ManagerRepository,
    private readonly executions: ManagerExecutionRepository,
    private readonly runtime: RuntimeHealthProbe,
    private readonly providers?: ProviderCatalogRepository
  ) {}

  async execute(command: StartManagerRunCommand): Promise<StartManagerRunResult> {
    const brief = command.message.trim();
    if (!brief) throw new DomainError("A manager brief is required", "MANAGER_BRIEF_REQUIRED");

    const manager = await this.managers.load(command.managerId);
    if (!manager) throw new DomainError(`Manager ${command.managerId} was not found`, "MANAGER_NOT_FOUND");
    const before = manager.snapshot();

    manager.startRun(command.context.occurredAt);

    const requested = await this.executions.validateStart(command.managerId);

    const runtime = await this.runtime.check();
    if (runtime.status !== "ok") {
      throw new DomainError("Temporal runtime is unavailable", "RUNTIME_UNHEALTHY");
    }

    let providerCatalogSnapshot;
    if (this.providers) {
      const snapshot = await this.providers.latest(requested.providerId);
      if (!snapshot) {
        throw new DomainError(
          `Provider ${requested.providerId} has not been explicitly probed`,
          "CAPABILITY_UNAVAILABLE"
        );
      }
      if (!snapshot.capabilities.start.available) {
        throw new DomainError(
          snapshot.capabilities.start.reason ?? "Provider start is unavailable",
          "CAPABILITY_UNAVAILABLE"
        );
      }
      if (!snapshot.models.some((model) => model.id === requested.modelId)) {
        throw new DomainError(
          `Model ${requested.modelId} was not returned by the provider probe`,
          "CAPABILITY_UNAVAILABLE"
        );
      }
      providerCatalogSnapshot = snapshot;
    }

    const reuseConversationId = command.newConversation ? null : command.conversationId;
    const isFirstTurn = reuseConversationId === null;
    const effectivePrompt = isFirstTurn
      ? `${before.instruction}\n\n${DEVFLOW_MANAGER_PREAMBLE}\n\n--- Demande de l'utilisateur ---\n${brief}`
      : brief;

    const workflowId = `manager/${command.managerId}/run/${command.runId}`;
    await this.executions.persistStart({
      manager,
      runId: command.runId,
      conversationId: command.conversationId,
      reuseConversationId,
      workflowId,
      auditId: command.auditId,
      outboxId: command.outboxId,
      effectivePrompt,
      briefPrompt: brief,
      context: command.context,
      ...(providerCatalogSnapshot ? { providerCatalogSnapshot } : {})
    });

    return {
      commandId: command.context.commandId,
      managerId: command.managerId,
      runId: command.runId,
      conversationId: command.conversationId,
      workflowId,
      state: "active",
      dispatchState: "pending"
    };
  }
}
