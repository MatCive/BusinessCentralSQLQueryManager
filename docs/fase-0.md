# Fase 0: setup e prova tecnica

## Scelta del motore SQL

Ho confrontato i due candidati in Node.js su dati sintetici simili a quelli di Business Central (5.000 clienti, movimenti contabili da 100.000 e 500.000 righe), con 15 query tipiche: TOP e ORDER BY, GROUP BY e HAVING, JOIN interni ed esterni, sottoquery, CASE, funzioni T-SQL. Lo script è `addin/bench/engine-compare.mjs` (`npm run bench`).

| Caso | alasql | SQLite (sql.js) |
|---|---|---|
| `WHERE [Country/Region Code] = 'it'` (la collation di BC non distingue maiuscole e minuscole) | 0 righe, sbagliato | 1.667, corretto |
| `7 / 2` (divisione intera in T-SQL) | 3,5, sbagliato | 3, corretto |
| `ISNULL([Source No.], '') = ''` | 0 righe, sbagliato | 40.045, corretto |
| Gli altri 12 casi | stesso risultato | stesso risultato |

Tempi a 500.000 righe: entrambi i motori eseguono le query in tempi compresi tra pochi millisecondi e circa un secondo. Alasql è più veloce su GROUP BY e JOIN, SQLite su ORDER BY e sottoquery. Caricare 500.000 righe in SQLite richiede circa 1,4 secondi. In Business Central il tempo che conta sarà quello della lettura dei dati da AL, molto più lungo di entrambi.

**Decisione: SQLite (sql.js, WebAssembly).** È l'unico dei due che dà risultati corretti su tutti i casi, e il suo dialetto è stabile e documentato. Alasql resta solo nello script di confronto.

## Come funziona la traduzione da T-SQL

La query viene analizzata con node-sql-parser (dialetto TransactSQL) e riscritta per SQLite:

- `TOP n` diventa `LIMIT n`; `TOP n PERCENT` non è supportato.
- `ISNULL` diventa `IFNULL`; `SUBSTRING` diventa `SUBSTR`.
- `LEN`, `LEFT`, `RIGHT`, `CHARINDEX`, `GETDATE`, `YEAR`, `MONTH`, `DAY`, `DATEADD`, `DATEDIFF`, `DATEPART` sono funzioni aggiunte a SQLite con il comportamento di SQL Server (per esempio 31 gennaio + 1 mese = 28 febbraio).
- L'operatore `+` concatena due testi e somma tutto il resto, come in T-SQL.
- `N'testo'` e i suggerimenti di tabella come `WITH (NOLOCK)` vengono accettati e ignorati.
- Le colonne di testo non distinguono maiuscole e minuscole nei confronti e negli ordinamenti, come la collation del database di BC.

Differenze note rispetto a SQL Server:

- I decimali sono numeri in virgola mobile: somme molto lunghe possono avere errori oltre la quinta cifra decimale. La griglia arrotonda a 5 decimali.
- Il confronto senza maiuscole/minuscole vale per le colonne, non per i risultati di espressioni (`UPPER(Name) = 'abc'` distingue).
- Le date vuote valgono `1753-01-01`, come nel database di BC; un'ora vuota vale NULL.

## Cosa è stato costruito

- `addin/`: parser e traduttore, motore SQLite, funzioni T-SQL, griglia semplice, export CSV e copia negli appunti. 22 test automatici (`npm test`), eseguiti anche su GitHub a ogni push.
- `app/`: estensione AL per BC29 (runtime 18) con la pagina SQL Query Manager, il codeunit che legge i dati con RecordRef, il control add-in e il permission set.

Il codice copre già buona parte delle fasi 1 e 2 (lettura dei dati, nomi di tabelle e campi, tipi, società, FlowField). Restano per le fasi successive i filtri applicati in AL, l'editor con evidenziazione, la griglia ordinabile e l'export Excel.

## Da verificare sul Docker

Il codice AL non è stato compilato in questo ambiente, quindi il primo passo è compilarlo.

1. Apri `SQM.code-workspace` in VS Code, controlla `server` e `serverInstance` in `app/.vscode/launch.json` e pubblica con F5. Se ci sono errori di compilazione, mandameli così come sono.
2. Apri la pagina **SQL Query Manager**. Il campo **SQL engine** deve dire `SQLite 3.54.1 ready`. Se dice "Not available", copia il testo: significa che il control add-in blocca WebAssembly e passo alla versione JavaScript pura di SQLite.
3. Prova queste query e annota quello che vedi:

```sql
SELECT TOP 10 [No.], Name, [Country/Region Code] FROM Customer ORDER BY Name

SELECT COUNT(*) FROM [G/L Entry]

SELECT [G/L Account No.], COUNT(*) AS N, SUM(Amount) AS Totale
FROM [G/L Entry] GROUP BY [G/L Account No.] ORDER BY Totale DESC

-- Option ed enum devono uscire come numeri (Order = 1)
SELECT TOP 10 [No.], [Document Type], Status FROM [Sales Header]

-- FlowField: calcolata solo perché è nominata
SELECT TOP 10 [No.], Name, [Balance (LCY)] FROM Customer ORDER BY [Balance (LCY)] DESC

-- Un'altra società (sostituisci il nome)
SELECT TOP 5 Name FROM [NOME SOCIETA$Customer]

-- Deve essere rifiutata
DELETE FROM Customer
```

4. Per la query sui movimenti contabili annota i tempi nella barra di stato (lettura BC, caricamento, query) e quante righe ha la tabella. Sono le misure che servono a fissare il limite di righe lette per tabella.
5. Prova i pulsanti **Copia** (poi incolla in Excel) e **CSV**: servono a verificare che Business Central permetta appunti e download dal control add-in.
