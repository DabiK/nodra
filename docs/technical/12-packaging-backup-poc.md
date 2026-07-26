# 12 — Runtime Temporal, données, sauvegarde et POC interdit avant gate

## Position de support

Nodra exige Node.js mais ne requiert jamais Temporal Cloud. Il télécharge et supervise un runtime **Temporal self-host** compatible avec l'OS/architecture, dans le data root. `temporal server start-dev` est uniquement une option de développement/POC : les sources officielles le présentent comme démarrage local et ne justifient pas sa distribution de production. Il est donc interdit de le promouvoir sans résultat POC. Sources : [Temporal service](https://github.com/temporalio/temporal), [CLI](https://github.com/temporalio/cli), [self-hosting](https://docs.temporal.io/self-hosted-guide).

## Distribution proposée, conditionnelle au POC

```text
<data-root>/
  nodra.sqlite, artifacts/, backups/, logs/
  temporal/
    current -> <version-os-arch>/
    <version-os-arch>/bin/...  manifest.json  sha256
    store/                    # persistance Temporal distincte
    logs/
```

1. Le manifeste Nodra associe version exacte, OS, arch, URL officielle et SHA-256 publié. Téléchargement dans un répertoire temporaire, taille/digest vérifiés, extraction anti-path-traversal, permissions restrictives, puis renommage atomique. Sans checksum officiel vérifiable, Nodra refuse l'installation automatique et indique la procédure manuelle : ne jamais accepter un binaire sans intégrité attestable.
2. Le superviseur choisit une plage de ports loopback libre et persistée dans `runtime-state.json` atomique (par défaut Temporal gRPC 7233, UI éventuellement 8233; aucun port ne doit être présumé disponible). Il passe configuration/persistence explicites, démarre un groupe de processus, redirige stdout/stderr rotatifs, et attend health RPC + worker poll, pas seulement un PID.
3. `start` est verrouillé singleton; stop envoie signal gracieux, attend délai, puis force seulement avec confirmation et marque les runs `reconciling`. Crash : redémarrage exponentiel limité, crash-loop bloque nouveaux starts et expose logs/diagnostic. Mise à jour télécharge à côté, valide health/migration sur copie, sauvegarde, bascule `current` atomiquement; rollback reste possible tant que les workflows/historiques sont compatibles.

Les releases exactes et le backend de persistance supporté ne sont pas inventés dans cette spécification : le POC doit retenir une configuration officiellement supportée à la version verrouillée (et pas une SQLite supposée). La persistance Temporal n'est pas le SQLite Nodra; leur répertoire et leurs sauvegardes restent séparés mais coordonnés.

## start-dev vs runtime supporté

| Sujet | `start-dev` | Runtime Nodra à valider |
| --- | --- | --- |
| rôle | dev/quickstart | distribution locale durable |
| persistance | option/dev, à vérifier | backend officiellement supporté, chemin explicite |
| upgrade | non homologué | pin + migration + rollback/replay |
| sécurité | defaults dev | loopback, permissions, logs redacted |
| supervision | terminal | PID/health/log/crash-loop |
| acceptation | jamais suffisante | matrice POC complète |

## Data root, backup, restore, upgrade

Backup cohérent : mode maintenance (nouveaux starts refusés), attendre ou signaler workflows selon politique, flush dispatcher, checkpoint backup SQLite, sauvegarde cohérente du store Temporal selon son mécanisme officiel, manifest avec versions, SHA-256 de chaque fichier et compatibilité. Artefacts sont copiés dédupliqués par digest. Restore vérifie manifest/digests dans un nouveau data root, restaure store Temporal puis SQLite, démarre isolé, réconcilie mapping workflowId/runId, et ne remplace l'ancien root qu'après health; sinon rollback par renommage. Upgrade Nodra suit migration SQLite puis migration Temporal documentée, avec backup préalable et test replay des workflows ouverts.

## Spécification du POC (seul dossier autorisable ultérieurement : `poc/temporal/`)

Le harness I6.2 placé dans `poc/temporal/` est une validation de développement pré-I7 : binaire déjà installé, `start-dev`, vrai worker, provider déterministe, idempotence et reprise. Il ne satisfait pas à lui seul la matrice packaging/recovery I10 ci-dessous.

Précondition : gate humain + ADR-004/005/008/010. Le POC I10 est isolé, sans import MVP ni modification de Nodra application. Il teste :

1. installer un runtime piné avec checksum sur macOS arm64/x64, Linux x64/arm64, Windows x64; démarrer et arrêter sans admin, ports auto, health/logs;
2. persister un Workflow, arrêter brutalement Nodra/worker puis reprendre sans perte et sans duplication Activity marquée idempotente;
3. Signal cancel/steer, Update approve/retry, Query état; timeout/heartbeat Activity;
4. backup/restore de SQLite+Temporal+artefacts dans root neuf; mapping stable;
5. upgrade runtime/worker et replay d'un historique existant; rollback documenté;
6. connecter les deux adapters via doubles/fixtures, puis probes humains Codex app-server et OpenCode server HTTP/OpenAPI si les environnements locaux requis sont disponibles; aucune probe ne parse un CLI provider ni n'exige Copilot.

Critères de sortie : aucune écriture cloud; aucune duplication d'effet test; health robuste après crash; persistance validée avec backend officiellement supporté; port conflict géré; uninstall ne supprime jamais data root sans confirmation; logs exploitables; chaque OS supporté ou explicitement retiré par décision propriétaire. Échec : pas de fallback Temporal Cloud, pas de scheduler interne implicite; le propriétaire reçoit le diagnostic et décide du support/architecture.
