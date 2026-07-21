# Charte de refactor

## Mandat

Transformer un MVP mature en produit robuste, maintenable, testable et évolutif, sans perdre les comportements utiles ni recopier ses contraintes accidentelles.

La phase 0 est une phase de discovery et de décision. Elle ne produit aucun code applicatif.

## Source et cible

| Rôle | Chemin | Règle |
| --- | --- | --- |
| Source d'analyse | `/Users/Dabi/Documents/devflow/api-v2` | Lecture seule stricte. Référence figée pour ce cadrage au commit `475ae382bb5a19cc889c79ab6d19b592d730a105`. Le dossier non suivi `demo-video/` préexistait au cadrage et est hors périmètre sauf preuve explicitement nécessaire. |
| Cible de cadrage | `/Users/Dabi/Documents/devflow/devflow-next` | Seuls les livrables documentaires de phase 0 peuvent être créés sous `docs/`. |

Toute dérive du commit source doit être signalée et les preuves concernées revalidées.

## Règles non négociables de phase 0

- **DEC-V** — Ne modifier aucun fichier du MVP, aucune donnée d'exécution et aucun dépôt ou workspace qu'il gère.
- **DEC-V** — Ne créer aucun code applicatif, scaffold produit, schéma de données exécutable ou dépendance dans la cible.
- **DEC-V** — La direction backend hexagonale et modulaire est validée. Les choix de découpage, stockage, transport et adaptateurs restent à proposer et à valider avant implémentation.
- **DEC-V** — Séparer strictement faits observés, intentions documentées, hypothèses, propositions, décisions validées et questions ouvertes.
- **DEC-V** — Préférer comportement et tests comme preuve lorsqu'ils contredisent README, captures ou roadmap.
- **DEC-V** — Citer les fichiers et, lorsque cela aide à reproduire le constat, les symboles, routes, tests ou commandes.
- **DEC-V** — Le jalon de cadrage s'appuie sur les preuves déjà collectées; il ne requiert pas cinq rapports spécialisés ni une parité documentaire avec le MVP.

## Contraintes produit validées

- **DEC-V — Branding.** Le nouveau produit s'appelle **Nodra**. Le nom **DevFlow** désigne uniquement le MVP historique analysé et n'est pas repris comme marque de la cible.
- **DEC-V — Local-first et mono-utilisateur.** Nodra reste un outil local pour un seul opérateur. Le cadrage exclut comptes, rôles, organisations, multi-tenant, collaboration temps réel et infrastructure SaaS.
- **DEC-V — Nouvelle base propre.** La nouvelle implémentation ne reprend pas les données historiques du MVP et ne fournit aucune rétrocompatibilité de format ou d'API à cette fin. L'analyse du MVP sert à identifier les concepts et comportements utiles, pas à conserver ses structures accidentelles.
- **DEC-V — Exécution multi-provider extensible.** Codex et GitHub Copilot sont les providers initiaux derrière un contrat d'adaptateur stable. Le domaine reste indépendant de leurs protocoles. Le socle produit requis est disponibilité, modèles, start, événements, stop, résultat, reprise, queue, steer, usage et pièces jointes; chaque adaptateur déclare sa faisabilité réelle, sans simulation ni fallback. L'ajout futur de Claude ou d'autres providers doit rester possible sans refonte du domaine.
- **DEC-V — Release V1 réduite et fiable.** La priorité est de réduire la charge mentale et d'indiquer la prochaine action utile pour un développeur solo expérimenté. Une mission autonome reste utilisable sans manager ni pipeline; toute capacité MVP non branchée est réévaluée avant réintégration.
- **DEC-V — Données et exploitation locales.** L'état métier vit dans une base transactionnelle locale; logs et artefacts volumineux sont séparés. Export/import manuel simple, secrets confiés aux providers ou à l'environnement système, reprise après crash et application web locale lancée par CLI sont requis.
- **DEC-V — Exécution durable.** Temporal self-host est le moteur durable retenu, sous réserve seulement du POC ultérieur autorisé après validation humaine. Temporal Cloud n'est jamais requis. Nodra gère localement son runtime Temporal versionné (installation, lancement, supervision, arrêt et mise à jour).
- **DEC-V — Stack.** TypeScript strict; NestJS avec adaptateur Express; React et Vite. SQLite Nodra reste la source de vérité métier; Temporal conserve le contrôle de l'exécution et son historique.
- **DEC-V — Contrôle du risque.** Tous les MCP et le preset full access sont disponibles par défaut. Ils restent visibles, auditables par mission, et les effets sensibles exigent une confirmation explicite; ces garde-fous ne réduisent pas silencieusement le choix produit.

## Invariants à préserver pendant le cadrage

Ces invariants portent sur la démarche; ils ne préjugent pas encore de la solution cible.

1. Traçabilité de chaque exigence vers une observation, une intention propriétaire ou une question ouverte.
2. Démarrage sur une base de données propre; aucune migration des données historiques du MVP. Les éventuelles migrations futures de la nouvelle implémentation devront être sûres et réversibles.
3. Distinction entre succès d'un agent, preuve vérifiée et acceptation humaine.
4. Action coûteuse ou à effet de bord déclenchée explicitement, jamais par simple inspection d'une vue.
5. État métier, historiques auxiliaires et journaux techniques traités comme des responsabilités distinctes.
6. Compatibilité des parcours critiques mesurée par critères d'acceptation, pas par ressemblance du code.
7. Les gates reposent sur des preuves structurées, vérifiables et extensibles : déclaration agent, observation Nodra et validation humaine sont distinctes.
8. Une capacité provider absente n'est jamais simulée : le contrôle est désactivé avec une explication et aucun changement de provider n'est automatique.

Les points 3 à 5 sont des invariants de travail issus du mandat et de comportements déjà connus; le PRD doit encore confirmer leur portée produit exacte. Les trois contraintes produit ci-dessus sont déjà validées et ne sont pas des questions ouvertes de phase 0.

## Discipline de preuve

Un constat important doit indiquer :

1. son statut (`OBS`, `INT`, `HYP`, `DEC-P`, `DEC-V` ou `Q`);
2. sa preuve primaire sous forme `chemin:ligne`, symbole, route ou nom de test;
3. la date et le commit source si le constat est susceptible de dériver;
4. ses contradictions et limites;
5. son impact sur exigences, architecture ou migration.

Les données runtime ne sont consultées que si elles apportent une preuve absente du code ou des tests. Elles ne doivent être ni recopiées en masse ni exposées dans les livrables.

## Périmètres d'analyse

- Produit : promesse, acteurs, parcours, capacités et contradictions documentation/comportement.
- Domaine/API/data : entités, invariants, transitions, contrats HTTP/CLI, persistance et migrations.
- Architecture/runtime/providers : frontières, dépendances, exécution agent, sessions, événements et moteurs.
- Frontend/UX/accessibilité : architecture d'information, états, interactions, feedback, responsive et accessibilité.
- Qualité/sécurité/ops : stratégie de tests, confiance des preuves, menace locale, secrets, fichiers, Git, exploitation et observabilité.

Chaque périmètre exclut les recommandations détaillées relevant d'un autre rapport. Les recouvrements nécessaires sont signalés comme dépendances, pas redéveloppés.

## Condition de sortie

Le cadrage V1 est prêt pour la prochaine validation lorsque :

- la cartographie AS-IS couvre les parcours et capacités critiques;
- le PRD V1 distingue explicitement périmètre V1, après V1 et rejeté, avec critères d'acceptation testables;
- les décisions produit sont intégrées et seules les ambiguïtés techniques réelles restent ouvertes;
- le dépôt source est inchangé et la cible ne contient aucun code applicatif;
- le propriétaire produit dispose d'un jalon explicite pour valider les choix techniques restants avant architecture détaillée.
