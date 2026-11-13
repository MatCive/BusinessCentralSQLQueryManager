# Business Central SQL Query Manager (SQM)

Estensione per Microsoft Dynamics 365 Business Central SaaS che permette di scrivere query in sintassi T-SQL ed eseguirle in **sola lettura** sui dati del tenant, con risultati in griglia ed export.

In Business Central SaaS non c'è accesso diretto al database: SQM legge i dati con AL e li elabora con SQLite, che gira nel browser dentro un control add-in.

```sql
SELECT c.[No.], c.Name, COUNT(*) AS Ordini
FROM Customer c
JOIN [Sales Header] sh ON sh.[Sell-to Customer No.] = c.[No.]
WHERE sh.[Document Type] = 1
GROUP BY c.[No.], c.Name
ORDER BY Ordini DESC
```

## Stato

Fase 0 (prova tecnica): codice pronto, in attesa della verifica sul Docker. Piano di lavoro: [docs/ROADMAP.md](docs/ROADMAP.md). Risultati e checklist della fase 0: [docs/fase-0.md](docs/fase-0.md).

## Struttura

- `app/`: estensione AL (PTE, publisher MCivera, prefisso SQM, ID da 90000, Business Central 29).
- `app/ControlAddIn/`: JavaScript e CSS del control add-in. `js/sqm.js` è generato da `addin/`: non modificarlo a mano.
- `addin/`: sorgenti JavaScript (parser T-SQL, motore SQLite, griglia) e relativi test.
- `docs/`: roadmap e documentazione.

## Sviluppo

**App AL.** Apri `SQM.code-workspace` in VS Code con l'estensione AL Language. In `app/.vscode/launch.json` imposta `server` e `serverInstance` del tuo container Docker, poi scarica i simboli e pubblica con F5. Per compilare l'app non serve Node.js.

**Control add-in.** Serve solo per modificare il JavaScript. Con Node.js 22:

```
cd addin
npm ci
npm test        # test automatici
npm run build   # rigenera app/ControlAddIn/js/sqm.js
```

Dopo una modifica al JavaScript va fatto il commit anche di `app/ControlAddIn/js/sqm.js`. La CI su GitHub controlla che sia aggiornato.
