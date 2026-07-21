# Nodra

Premier incrément vertical exécutable du socle local Nodra.

## Démarrage local

```bash
npm install
npm run db:setup
npm run dev
```

- API health : `http://127.0.0.1:4100/health`
- Base locale : `data/nodra.db` (modifiable avec `NODRA_DATABASE_FILE`)

## CLI locale

La CLI utilise les mêmes cas d'usage applicatifs et la même base SQLite que l'API.

```bash
npm run cli -- health
npm run cli -- mission:create "Préparer I2"
```

## Qualité

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Temporal et les providers sont volontairement absents du runtime de cet incrément. `WorkflowPort` existe dans l’application et son adaptateur placeholder échoue explicitement avec `WORKFLOW_UNAVAILABLE`.
