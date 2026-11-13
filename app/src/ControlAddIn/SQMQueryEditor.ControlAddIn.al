/// <summary>
/// Query editor, SQL engine (SQLite compiled to WebAssembly) and result grid.
/// The JavaScript sources are in the addin folder of the repository; ControlAddIn/js/sqm.js is their build.
/// </summary>
controladdin "SQM Query Editor"
{
    Scripts = 'ControlAddIn/js/sqm.js';
    StartupScript = 'ControlAddIn/js/startup.js';
    StyleSheets = 'ControlAddIn/css/sqm.css';

    RequestedHeight = 640;
    MinimumHeight = 400;
    VerticalStretch = true;
    VerticalShrink = true;
    HorizontalStretch = true;
    HorizontalShrink = true;

    /// <summary>The add-in has started. InfoJson: {"ok": bool, "version": text, "error": text, "webAssembly": bool}.</summary>
    event ControlReady(InfoJson: Text);
    /// <summary>The user pressed Run or Ctrl+Enter in the editor.</summary>
    event RunRequested();
    /// <summary>The query needs these tables. RequestJson: {"tables": [{"key", "company", "table", "allColumns", "columns"}]}.</summary>
    event DataRequested(RequestJson: Text);
    /// <summary>The query ran. StatsJson: {"rows", "truncated", "readMs", "loadMs", "execMs", "totalMs"}.</summary>
    event QueryCompleted(StatsJson: Text);

    /// <summary>Sets the language of the add-in texts (Windows language ID, 1040 = Italian).</summary>
    procedure SetLanguage(LanguageId: Integer);
    /// <summary>Replaces the text in the editor.</summary>
    procedure SetQuery(QueryText: Text);
    /// <summary>Runs the query in the editor; the add-in answers with DataRequested.</summary>
    procedure Execute(RowLimit: Integer);
    /// <summary>Sends one chunk of table data, as built by codeunit "SQM Data Reader".</summary>
    procedure ReceiveTable(ChunkJson: Text);
    /// <summary>All requested tables have been sent: the add-in runs the query.</summary>
    procedure DataComplete();
    /// <summary>Shows an error and stops the current run.</summary>
    procedure ShowError(ErrorText: Text);
}
