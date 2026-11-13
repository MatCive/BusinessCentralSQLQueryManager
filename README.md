# Business Central SQL Query Manager (SQM)

Estensione per Microsoft Dynamics 365 Business Central SaaS che permette di scrivere query in sintassi T-SQL ed eseguirle in **sola lettura** sui dati del tenant, con risultati in griglia ed export in Excel, CSV e JSON.

In Business Central SaaS non c'è accesso diretto al database: SQM legge i dati con AL e li elabora con un motore SQL che gira nel browser, dentro un control add-in.

```sql
SELECT c.[No.], c.Name, COUNT(*) AS Ordini
FROM Customer c
JOIN [Sales Header] sh ON sh.[Sell-to Customer No.] = c.[No.]
WHERE sh.[Document Type] = 1
GROUP BY c.[No.], c.Name
ORDER BY Ordini DESC
```

## Stato

In sviluppo. Piano di lavoro e decisioni prese: [docs/ROADMAP.md](docs/ROADMAP.md).

## Dati tecnici

- Tipo: Per-Tenant Extension (PTE)
- Publisher: MCivera
- Prefisso oggetti: SQM
- Range ID: da 90000
- Versione minima: Business Central 29
