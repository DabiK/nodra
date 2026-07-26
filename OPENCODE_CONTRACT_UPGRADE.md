# Mise à niveau du contrat OpenCode Serve

I8 certifie le sous-contrat HTTP/OpenAPI réellement consommé par Nodra, pas
l'intégralité de l'API OpenCode. La forme certifiée est OpenCode Serve `1.18.5`
avec le digest SHA-256 `/doc`
`f5cb443f0d160fc4b17190f64c2401f199160eb2137ce4e00ca319b99aa34005`.

Le probe explicite classe le contrat ainsi :

- `certified` : version et digest connus ;
- `compatible_unverified` : version ou digest différent, mais les primitives
  nécessaires existent toujours ; les runs restent autorisés avec warning ;
- `incompatible` : une primitive consommée manque ou une réponse indispensable
  viole le contrat ; les nouveaux runs OpenCode sont bloqués.

Un changement mineur de version ou de digest ne bloque donc jamais seul une
mission.

## Sous-contrat consommé

Le probe lit uniquement :

- `GET /global/health` : `{ healthy: true, version: string }` ;
- `GET /doc` : contrat OpenAPI 3.1, conservé par digest ;
- `GET /config/providers` : providers, modèles et défauts.

Un run utilise uniquement :

- `POST /session`, `GET /session/:id` pour créer/reprendre ;
- `POST /session/:id/prompt_async`, y compris le champ optionnel documenté
  `variant` pour un effort exposé par le catalogue ;
- `GET /session/:id/message` pour le résultat persistant ;
- `POST /session/:id/abort` ;
- `GET /event` SSE ;
- `POST /session/:id/permissions/:permissionID` avec `once|reject`.

Les noms de paramètres OpenAPI (`id`, `sessionID`, etc.) sont normalisés
uniquement pour comparer les chemins. Les méthodes, chemins, corps et réponses
restent ceux du SDK généré depuis `/doc`.

## Procédure reproductible

1. Relever la version sans lancer de mission :

   ```bash
   opencode --version
   opencode serve --help
   ```

2. Démarrer explicitement un serveur temporaire loopback avec seulement les
   flags confirmés par `serve --help` :

   ```bash
   /chemin/absolu/opencode serve \
     --hostname 127.0.0.1 \
     --port <port-libre> \
     --pure \
     --print-logs
   ```

   Utiliser `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`,
   `OPENCODE_CONFIG` et `OPENCODE_CONFIG_DIR` dirigés vers un root temporaire.
   Ne pas transmettre de clé externe.

3. Exporter le contrat sans session ni message :

   ```bash
   npm run opencode:schema:export -- \
     --url http://127.0.0.1:<port-libre> \
     --out .artifacts/opencode-server-schema-<version>
   ```

   Le script ne démarre aucun serveur. Il exige une URL HTTP loopback, lit
   `/global/health` et `/doc`, puis écrit `openapi.json|html` et
   `manifest.json` avec version, digest et matrice des primitives.

4. Comparer le manifeste, les types du SDK officiel `@opencode-ai/sdk`, les
   fixtures HTTP/SSE et l'adapter. Une propriété additionnelle ou un événement
   inconnu n'est pas une rupture. Une primitive manquante ou une réponse
   indispensable invalide l'est.

5. Mettre à jour ensemble la version/digest certifiés, les fixtures, les tests
   et [I8-opencode-serve-ollama.md](docs/implementation/I8-opencode-serve-ollama.md),
   puis exécuter les validations déterministes avant tout test modèle réel.

## Rollback

Ne pas modifier les constantes certifiées si une primitive échoue. Conserver
le dernier adapter vert, arrêter le serveur temporaire et déplacer uniquement
son root temporaire à la Corbeille. Un serveur plus récent reste utilisable en
`compatible_unverified` si le sous-contrat passe ; aucune sélection d'un autre
provider Nodra n'est autorisée comme fallback.
