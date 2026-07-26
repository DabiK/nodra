# OpenCode Serve — sources officielles consultées pour I8

Consultation Context7 et documentation officielle le 26 juillet 2026.

- Bibliothèque Context7 principale : `/anomalyco/opencode`.
- SDK officiel : `@opencode-ai/sdk`, package `1.18.5`, mode client-only via
  `createOpencodeClient({baseUrl})`.
- Serveur officiel :
  [opencode.ai/docs/server](https://opencode.ai/docs/server/).
- SDK officiel :
  [opencode.ai/docs/sdk](https://opencode.ai/docs/sdk/).
- Configuration provider local :
  [opencode.ai/docs/providers/#ollama](https://opencode.ai/docs/providers/#ollama).
- Isolation de configuration :
  [opencode.ai/docs/config](https://opencode.ai/docs/config/).

Le serveur documente `opencode serve`, le bind loopback par défaut, `/doc`,
`/global/health`, `/config/providers`, sessions, messages, abort, permissions
et `/event` SSE. Le SDK est généré depuis l'OpenAPI et peut se connecter à un
serveur existant sans le démarrer.

Context7 exposait aussi des extraits d'une API V2 en développement sous
`/api/*`. I8 ne les mélange pas au contrat Serve stable demandé : l'adapter
utilise uniquement les chemins présents dans le `/doc` du binaire installé et
dans le SDK officiel de même version.

OpenCode nomme `ollama` dans sa configuration interne de fournisseur de modèle.
Cette valeur ne franchit jamais la frontière adapter/catalogue namespacé :
le seul `providerId` Nodra est `opencode`.
