# Architecture cible — contraintes et options

Statut : **direction validée; conception dans `docs/technical/`, validation implementation-ready encore bloquée par les décisions explicitement ouvertes**.

## Contraintes validées

1. Déploiement local mono-utilisateur, application web lancée par CLI, sans identité, collaboration ou SaaS.
2. Nouvelle base propre avec état métier transactionnel local, sans couche d'import ou de compatibilité historique MVP; logs/artefacts séparés.
3. Domaine indépendant de Codex, Copilot et futurs protocoles provider.
4. Socle provider commun et capacités optionnelles interrogables par le produit.
5. Codex et GitHub Copilot comme premiers adaptateurs; ajout futur de Claude ou autre sans refonte métier.
6. Temporal self-host local est le moteur durable, jamais Temporal Cloud; Nodra exploite son runtime. SQLite demeure la vérité métier.

## Direction validée

- **DEC-V** — Backend hexagonal et modulaire : domaine indépendant des providers; cas d'usage partagés par UI et CLI; adaptateurs provider séparés; persistance métier, journal technique et artefacts volumineux séparés.
- **DEC-V** — Le contrat provider exprime les capacités produit exigées et les capacités réellement disponibles. Une absence reste visible et ne déclenche ni fallback ni simulation.
- **DEC-V** — Les gates utiliseront une preuve structurée distincte de la déclaration agent et de l'acceptation humaine; le modèle précis est `Q-T01`.
- **DEC-V** — NestJS utilise Express. UI React/Vite et CLI appellent les mêmes cas d'usage.
- **DEC-V** — Codex est intégré par app-server JSON-RPC; Copilot par son SDK officiel.
- **DEC-V** — SQLite est implémenté dans l'adaptateur sortant par Drizzle ORM : schéma TypeScript strict et migrations générées. Le domaine/application n'en dépendent pas; SQL manuel seulement pour les primitives SQLite non correctement couvertes, documentées et validées.

## Décisions reportées

Le découpage, les schémas, les contrats, la cohérence, le packaging, les tests et le POC sont spécifiés dans `docs/technical/`; aucun code applicatif n'est autorisé avant le gate humain.
