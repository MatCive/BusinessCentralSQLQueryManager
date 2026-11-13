# Business Central SQL Query Manager (SQM)

*Roadmap, versione 0.1 del 13 novembre 2026*

## Obiettivo

SQM è un'estensione per Business Central SaaS che permette di scrivere query in sintassi T-SQL ed eseguirle in sola lettura sui dati del tenant, con i risultati in una griglia e l'export, come si farebbe con SQL Server Management Studio su un database on-premise.

In SaaS non c'è accesso diretto al database e AL non può creare oggetti Query a runtime. Per questo l'app non passa la query a SQL Server: la interpreta. AL legge i dati e un motore SQL che gira nel browser esegue la query.

## Decisioni prese

- **Distribuzione:** PTE, progetto personale. Publisher `MCivera`, prefisso `SQM`, ID oggetti da 90000.
- **Versione minima:** Business Central 29.
- **Architettura:** ibrida. AL legge i dati delle tabelle, un control add-in JavaScript esegue la query con un motore SQL nel browser.
- **Dialetto:** fedele a T-SQL (parentesi quadre, `TOP`, funzioni T-SQL più usate).
- **Nomi:** tabelle e campi con il nome AL in inglese, per esempio `SELECT [No.], Name FROM Customer`.
- **Società:** di default la società corrente; le altre con la sintassi `[Società$Tabella]`, per esempio `[CRONUS$Customer]`.
- **Tabelle:** tutte, incluse quelle di sistema e virtuali. I campi BLOB e Media sono esclusi.
- **FlowField:** calcolate solo se nominate esplicitamente; `SELECT *` non le include.
- **Option ed Enum:** restituiti come intero, come nel database.
- **Limite righe:** campo intero nella pagina, 1000 di default, modificabile dall'utente durante la sessione.
- **Editor:** control add-in con evidenziazione della sintassi.
- **Risultati:** griglia HTML nel control add-in.
- **Export:** Excel, CSV, JSON e copia negli appunti. Nella prima versione le query non vengono salvate.
- **Sola lettura:** le istruzioni che modificano dati (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE` e simili) vengono rifiutate.
- **Lingue:** inglese come base, traduzione italiana in XLIFF.
- **Sviluppo:** codice scritto da Claude e pubblicato su GitHub; test sul container Docker locale.

## Architettura

Il percorso di una query, dall'editor alla griglia:

1. L'utente scrive la query nell'editor del control add-in e preme Esegui.
2. Il JavaScript analizza la query con un parser T-SQL e ricava le tabelle usate, la società di ciascuna, i campi necessari e i filtri semplici che riguardano una sola tabella.
3. Il JavaScript chiede ad AL i dati di quelle tabelle, passando campi e filtri.
4. AL trova tabelle e campi nei metadati di sistema (`AllObjWithCaption`, `Field`), apre ogni tabella con `RecordRef` (con `ChangeCompany` se serve), legge solo i campi necessari (`SetLoadFields`), applica i filtri (`SetFilter`), calcola le FlowField richieste e restituisce le righe in JSON, a blocchi.
5. Il motore SQL nel browser carica le tabelle ed esegue la query completa: JOIN, GROUP BY, sottoquery, ordinamento.
6. La griglia mostra il risultato, tagliato al limite di righe impostato.
7. L'export prende il risultato e genera il file.

I filtri vengono applicati in AL perché un JOIN o un GROUP BY ha bisogno di tutte le righe delle tabelle coinvolte, non solo delle prime 1000. Più filtri applica AL, meno dati passano dal browser e più la query è veloce.

Poiché AL legge con `RecordRef`, l'utente vede solo le tabelle su cui ha permesso di lettura in Business Central. L'app non concede permessi aggiuntivi sui dati.

### Conversione dei tipi

- Code e Text: testo.
- Integer, BigInteger, Decimal: numero.
- Boolean: 0 o 1, come il tipo bit di SQL Server.
- Date, DateTime, Time: data e ora in formato ISO.
- Option ed Enum: intero.
- Guid, DateFormula, RecordId: testo.
- BLOB, Media, MediaSet: esclusi.

### Struttura della repository

- `app/`: l'estensione AL (`app.json`, sorgenti in `src/`).
- `app/ControlAddIn/`: JavaScript e CSS già compilati e inclusi nell'app, così per compilare l'app in VS Code non serve Node.js.
- `addin/`: sorgenti JavaScript del control add-in (parser, motore, editor, griglia) con i relativi test.
- `test/`: test app AL.
- `docs/`: roadmap e documentazione.
- `.github/workflows/`: CI.

## Fasi

### Fase 0: setup e prova tecnica

Scopo: scegliere il motore SQL provandolo con dati reali, prima di costruirci sopra il resto.

- Scheletro del progetto AL (`app.json` per BC29, `launch.json` per il Docker, cartelle) e del progetto JavaScript.
- Confronto tra due motori: alasql (JavaScript puro, dialetto vicino a T-SQL) e SQLite compilato in WebAssembly (sql.js), con la query tradotta da T-SQL a SQLite tramite un parser come node-sql-parser.
- Verifiche dentro il control add-in di BC: WebAssembly, download di file, accesso agli appunti.
- Misura dei tempi di trasferimento da AL al browser su tabelle grandi, per esempio 100.000 movimenti contabili.

Risultato: motore scelto, con le misure e i motivi documentati in `docs/`.

### Fase 1: primo flusso completo

- Pagina SQL Query Manager con editor di testo semplice, campo limite righe (1000) e azione Esegui.
- SELECT su una sola tabella senza filtri: AL legge, il motore esegue, la griglia mostra.
- Errori di base: tabella inesistente, sintassi non valida.

Risultato: `SELECT * FROM Customer` funziona sul Docker.

### Fase 2: metadati, tipi e società

- Risoluzione dei nomi AL di tabelle e campi, con parentesi quadre per i nomi con spazi o punti.
- Conversione dei tipi, esclusione di BLOB e Media, Option ed Enum come intero.
- FlowField calcolate solo se nominate.
- Sintassi `[Società$Tabella]` con `ChangeCompany`.
- Lettura dei soli campi usati e accesso a tutte le tabelle, incluse quelle di sistema.

### Fase 3: SQL della prima versione

- `WHERE`, `ORDER BY`, `TOP`, `DISTINCT`.
- JOIN: `INNER`, `LEFT`, `RIGHT`, `FULL`.
- `GROUP BY`, `HAVING` e aggregazioni (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`).
- `CASE` e sottoquery.
- Funzioni T-SQL più usate, elenco da confermare: `ISNULL`, `COALESCE`, `CAST`, `CONVERT`, `LEFT`, `RIGHT`, `LEN`, `UPPER`, `LOWER`, `LTRIM`, `RTRIM`, `GETDATE`, `DATEADD`, `DATEDIFF`, `YEAR`, `MONTH`, `DAY`.
- Filtri semplici applicati in AL: `=`, `<>`, `<`, `>`, `BETWEEN`, `IN`, `LIKE` su una sola tabella.
- Rifiuto esplicito di tutto ciò che non è una SELECT.

### Fase 4: editor e griglia

- Editor con evidenziazione della sintassi (CodeMirror o equivalente) ed errori con riga e colonna.
- Griglia HTML con ordinamento per colonna, scorrimento fluido su migliaia di righe, numero di righe e tempo di esecuzione.

### Fase 5: export

- Excel, CSV e JSON.
- Copia del risultato negli appunti.

### Fase 6: rifinitura e rilascio 1.0

- Traduzione italiana in XLIFF e permission set per l'uso dell'app.
- Prestazioni, messaggi d'errore e guida d'uso.
- Pacchetto `.app` da installare come PTE.

## Test e CI (proposta)

La test app è una seconda estensione AL che contiene solo test automatici: codeunit che chiamano le funzioni dell'app e verificano il risultato, per esempio che `[No.]` venga risolto nel campo giusto o che un Boolean diventi 0 o 1. Si eseguono sul Docker con un clic e dicono subito se una modifica ha rotto qualcosa che prima funzionava.

La CI (integrazione continua) è un automatismo di GitHub: a ogni push un server di GitHub prende il codice, lo compila ed esegue i test, e segna il commit con una spunta verde o una croce rossa. Per una repository pubblica è gratuita.

In questo progetto la logica più delicata (parser, traduzione T-SQL, conversione dei tipi) è in JavaScript, e i test JavaScript girano anche senza Business Central. La proposta è quindi:

- da subito, test JavaScript eseguiti in CI a ogni push;
- dalla fase 2, test app AL per lettura dei metadati e conversione dei tipi, eseguita sul Docker;
- più avanti, se utile, compilazione dell'app AL anche in CI con AL-Go for GitHub, il modello di Microsoft per i progetti AL.

## Funzionalità future

- `DECLARE` e `SET` di variabili, più istruzioni nello stesso batch.
- CTE (`WITH`), `UNION`, tabelle temporanee (`#temp`), funzioni finestra (`ROW_NUMBER` e simili).
- Query salvate e condivise, con parametri.
- Autocompletamento di tabelle e campi nell'editor.
- Scelta a setup del tipo di griglia (HTML o pagina BC).
- Permission set dedicato, tabelle vietate e log delle query eseguite.

## Punti aperti

- **DECLARE:** era nella richiesta iniziale ma non nell'elenco della prima versione, quindi per ora è tra le funzionalità future. Da confermare.
- **Limite sulle righe lette:** il limite di 1000 vale sul risultato, ma un JOIN può dover leggere tabelle intere. Proposta: un secondo limite tecnico sulle righe lette per tabella, con un messaggio chiaro quando viene superato. Il valore si fissa dopo le misure della fase 0.
- **Motore SQL:** si sceglie alla fine della fase 0.
- **Test e CI:** da confermare la proposta qui sopra.
