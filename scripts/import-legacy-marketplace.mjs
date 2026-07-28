/* global URL, console, process */

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const database = new Database(`${root}data/nodra.db`);
const now = () => new Date().toISOString();

const tasks = [
  ["[Marketplace] Continuer le BC Marketplace", "READY", "Ancien etat: todo.\n\nRecapitulatif: reprendre le bounded context Marketplace dans bff-care-dcom.\n\nReste a faire: organiser les tickets DPD-5666 a DPD-5671, confirmer les dependances et choisir le prochain lot."],
  ["[Marketplace][DPD-5666] Controle de propriete miraklOrderId", "READY", "Ancien etat: todo.\n\nRecapitulatif: definir et implementer, seulement apres validation, le controle entre client connecte et commande Marketplace. Base feature/DPD-5665; source legacy C:\\Users\\dkeita\\Documents\\front-dcom-2.\n\nReste a faire: prouver le contrat ws-user/source aval et le comportement 403/404, arbitrer la portee (tous endpoints ou seller-contact), puis implementer avec CustomerIdentityGateway, tests et gradlew check. Pas d'integration directe."],
  ["[Marketplace][DPD-5667] Evaluation vendeur", "READY", "Ancien etat: todo.\n\nRecapitulatif: migrer GET questions et POST seller-evaluation en respectant strictement le contrat Jira et legacy.\n\nReste a faire: confirmer routes, headers, null aval et la portee DPD-5666; sinon bloquer avec arbitrage. Ajouter tests MVC/application/gateway et executer gradlew check. Pas d'integration directe."],
  ["[Marketplace][DPD-5668] Implementation ISO legacy - litiges et reception", "ACTIVE", "Ancien etat: in_progress; agent termine mais validation humaine absente.\n\nRecapitulatif: implementation ISO legacy de la confirmation de reception et des endpoints complaints/open et complaints/close. Base feature/DPD-5665; source de verite front-dcom-2.\n\nReste a faire: verifier le worktree et les contrats exacts (dont miraklLineId vers orderLineId a la frontiere ws-user), revoir tests MVC/application/gateway, executer gradlew.bat check et conserver la preuve de tout echec Gradle non lie. Ne pas integrer directement."],
  ["[Marketplace][DPD-5668] Tests - remplacer JSON inline par fixtures", "BLOCKED", "Ancien etat: in_progress, agent cancelled.\n\nRecapitulatif: remplacer les JSON inline des tests DPD-5668 par des fixtures lisibles et conformes aux conventions du depot.\n\nReste a faire: reprendre dans un worktree base feature/DPD-5668, conserver les scenarios confirm-reception et complaints, puis executer :marketplace:test, gradlew.bat check et git diff --check. Ne pas pousser ni creer de MR."],
  ["[Marketplace][DPD-5669] Analyse approfondie legacy", "READY", "Ancien etat: todo.\n\nRecapitulatif: analyser en profondeur le comportement legacy Marketplace dans front-dcom-2 pour preparer DPD-5669.\n\nReste a faire: documenter routes, payloads, headers, statuts, erreurs et dependances avant toute implementation."],
  ["[Marketplace][DPD-5669] Messagerie JSON et multipart", "READY", "Ancien etat: todo.\n\nRecapitulatif: migrer GET messages, POST JSON et seller-contact multipart sans fusion implicite des contrats aval/public.\n\nReste a faire: confirmer routes, media types, statuts, headers et portee DPD-5666; prouver bytes/Base64 et multipart optionnel. Ajouter tests et executer gradlew check. Pas d'integration directe."],
  ["[Marketplace][DPD-5670] Telechargement de pieces jointes", "READY", "Ancien etat: todo.\n\nRecapitulatif: migrer GET attachment avec octets binaires, 400 si segment absent et 404 si aval null.\n\nReste a faire: prouver le contrat ws-user (filename, MIME, metadata), respecter les dependances DPD-5666/5669, ajouter tests octets/Unicode/404 et executer gradlew check. Ne pas integrer directement."],
  ["[Marketplace][DPD-5671] Bascule, observabilite et decommissionnement", "READY", "Ancien etat: todo. Base feature/DPD-5665; Jira recupere le 23/07/2026.\n\nRecapitulatif: preparer la bascule progressive, l'observabilite, le rollback et le decommissionnement apres DPD-5664 a DPD-5670.\n\nReste a faire: definir dashboards volume/latence/erreurs/refus, logs sans secret, runbook et go/no-go; tester rollback avant retrait legacy; arbitrer kill-switch 404 ou 503 Retry-After avec produit/ops. Aucun deploiement ni suppression sans validation humaine."],
  ["[Marketplace][DPD-5665 MR !17] Revue et validation finale", "BLOCKED", "Ancien workflow: analyse et securite terminees, etape de test annulee, validation finale todo.\n\nRecapitulatif: revue independante et non destructive de la MR !17 feature/DPD-5665 vers feature/marketplace. Le dernier etat signalait conflits, Draft, discussion bloquante/non resolue et Quality Gate SonarQube en echec; risque IDOR/BOLA a verifier.\n\nReste a faire: revalider le SHA courant, traiter les conflits et discussions, recuperer les issues Sonar, verifier contrat HTTP et absence de propagation Caller/Authorization, puis rendre un verdict humain. Ne pas modifier, pousser ou integrer sans validation explicite."]
];

const runCli = (arguments_) => JSON.parse(execFileSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "apps/cli/src/main.ts", ...arguments_],
  { cwd: root, encoding: "utf8" }
));

for (const [title, state, description] of tasks) {
  if (database.prepare("select 1 from mission where title = ?").get(title)) continue;
  const mission = runCli(["mission:create", title]);
  database.prepare("update mission set description = ? where id = ?").run(description, mission.id);
  if (state === "READY" || state === "ACTIVE" || state === "BLOCKED") {
    runCli(["mission:prepare", mission.id, "0"]);
  }
  if (state === "ACTIVE" || state === "BLOCKED") {
    runCli(["mission:pickup", mission.id, "1"]);
  }
  if (state === "BLOCKED") {
    runCli(["mission:block", mission.id, "2", "Ancien travail annule ou en attente de reprise humaine."]);
  }
}

const managers = [
  ["migration-spring-bff-care", "Tu es le specialiste de la migration et modularisation de front-dcom-2 vers bff-care-dcom. Source: C:\\Users\\dkeita\\Documents\\front-dcom-2. Cible: C:\\Users\\dkeita\\Documents\\bff-care-dcom. Commence par confirmer le perimetre Jira, ses sous-taches et liens, puis inspecte les deux depots. Pour chaque ticket, fournis besoins et criteres d'acceptation, inventaire source, correspondance cible, architecture Spring proposee, sous-taches ordonnees, risques, tests et criteres de fin. Ne deduis pas de contenu Jira inaccessible. Avant toute ecriture, branche, configuration, migration ou integration, presente un plan et demande confirmation. Utilise un worktree pour chaque implementation approuvee; n'integre jamais sans revue humaine. Reponds en francais, de facon concise et actionnable."],
  ["modularisation-identity", "Tu es le manager de la modularisation et fiabilisation du BFF Identity. Perimetre: C:\\Users\\dkeita\\Documents\\Identity-api\\Identity et C:\\Users\\dkeita\\Documents\\ws-user. Tu transformes les diagnostics de performance et fiabilite en taches ordonnees et verifiables. Analyse les depots et outils d'observabilite accessibles, mais ne modifies pas le code et ne demarres pas une implementation sans demande explicite. Couvre cache-miss Couchbase versus indisponibilite, enrichissements Siebel bornes, budget de delai Identity vers ws-user, observabilite et protocole de charge. Toute implementation future doit utiliser un worktree. Termine chaque analyse par la prochaine decision requise. Reponds en francais et de facon concise."],
  ["oko", "Tu es le manager generique d'orchestration Nodra. Aide a concevoir, creer, lancer et superviser des pipelines reutilisables et des managers specialises. Clarifie objectif, depot, etapes, dependances, criteres de qualite et niveau d'automatisation. Inspecte l'etat avant mutation. Ne cree, ne modifie, ne supprime, ne lance et ne stoppe aucune ressource sans demande explicite ou confirmation si impact ambigu. Pour les pipelines, utilise des transitions humaines pour les actions a risque. Apres chaque action, rapporte identifiants, configuration, etat et prochaine decision. Reponds en francais, de facon concise et actionnable."]
];

for (const [name, instruction] of managers) {
  if (database.prepare("select 1 from manager where name = ? and archived_at is null").get(name)) continue;
  runCli(["manager:create", name, "--instruction", instruction, "--provider", "opencode", "--model", "default", "--effort", "medium", "--permission", "workspace"]);
}

const imported = database.prepare("select title, state, length(description) as descriptionLength from mission where title like '[Marketplace]%' order by title").all();
console.log(JSON.stringify({ imported, managers: database.prepare("select name from manager where name in ('migration-spring-bff-care', 'modularisation-identity', 'oko') order by name").all(), importedAt: now() }, null, 2));
