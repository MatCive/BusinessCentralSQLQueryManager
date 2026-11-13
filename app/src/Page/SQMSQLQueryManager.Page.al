/// <summary>
/// Main page: query editor, limits and results.
/// </summary>
page 90000 "SQM SQL Query Manager"
{
    Caption = 'SQL Query Manager';
    PageType = Card;
    ApplicationArea = All;
    UsageCategory = Tasks;
    LinksAllowed = false;

    layout
    {
        area(Content)
        {
            group(Settings)
            {
                Caption = 'Settings';

                field(RowLimitField; RowLimit)
                {
                    Caption = 'Max. result rows';
                    ToolTip = 'Specifies the maximum number of rows shown in the result.';
                    MinValue = 1;
                }
                field(MaxSourceRowsField; MaxSourceRows)
                {
                    Caption = 'Max. rows read per table';
                    ToolTip = 'Specifies the maximum number of rows read from each table in the query. 0 means no limit. If a table has more rows, the result may be incomplete and a warning is shown.';
                    MinValue = 0;
                }
                field(EngineStatusField; EngineStatus)
                {
                    Caption = 'SQL engine';
                    ToolTip = 'Specifies whether the SQL engine in the browser started.';
                    Editable = false;
                }
            }
            usercontrol(Editor; "SQM Query Editor")
            {
                ApplicationArea = All;

                trigger ControlReady(InfoJson: Text)
                begin
                    OnEditorReady(InfoJson);
                end;

                trigger RunRequested()
                begin
                    RunQuery();
                end;

                trigger DataRequested(RequestJson: Text)
                begin
                    SendData(RequestJson);
                end;

                trigger QueryCompleted(StatsJson: Text)
                begin
                end;
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Run)
            {
                Caption = 'Run';
                ToolTip = 'Run the query. In the editor you can also press Ctrl+Enter.';
                Image = Start;

                trigger OnAction()
                begin
                    RunQuery();
                end;
            }
        }
        area(Promoted)
        {
            actionref(Run_Promoted; Run)
            {
            }
        }
    }

    trigger OnOpenPage()
    begin
        RowLimit := 1000;
        MaxSourceRows := 200000;
        EngineStatus := StartingLbl;
    end;

    var
        RowLimit: Integer;
        MaxSourceRows: Integer;
        EngineStatus: Text;
        EditorReady: Boolean;
        StartingLbl: Label 'Starting...';
        EngineReadyLbl: Label 'SQLite %1 ready', Comment = '%1 = SQLite version';
        EngineFailedLbl: Label 'Not available: %1', Comment = '%1 = error text';

    local procedure OnEditorReady(InfoJson: Text)
    var
        Info: JsonObject;
        Token: JsonToken;
        Ok: Boolean;
        Version: Text;
        ErrorText: Text;
    begin
        if Info.ReadFrom(InfoJson) then begin
            if Info.Get('ok', Token) then
                Ok := Token.AsValue().AsBoolean();
            if Info.Get('version', Token) then
                Version := Token.AsValue().AsText();
            if Info.Get('error', Token) then
                ErrorText := Token.AsValue().AsText();
        end;
        if Ok then
            EngineStatus := StrSubstNo(EngineReadyLbl, Version)
        else
            EngineStatus := StrSubstNo(EngineFailedLbl, ErrorText);
        CurrPage.Editor.SetLanguage(GlobalLanguage());
        EditorReady := true;
        CurrPage.Update(false);
    end;

    local procedure RunQuery()
    begin
        if not EditorReady then
            exit;
        if RowLimit < 1 then
            RowLimit := 1000;
        CurrPage.Editor.Execute(RowLimit);
    end;

    local procedure SendData(RequestJson: Text)
    var
        DataReader: Codeunit "SQM Data Reader";
        Chunks: List of [Text];
        Chunk: Text;
    begin
        if not DataReader.TryReadTables(RequestJson, MaxSourceRows, Chunks) then begin
            CurrPage.Editor.ShowError(GetLastErrorText());
            exit;
        end;
        foreach Chunk in Chunks do
            CurrPage.Editor.ReceiveTable(Chunk);
        CurrPage.Editor.DataComplete();
    end;
}
