/// <summary>
/// Reads the tables requested by the query editor and returns them as JSON chunks.
/// Read-only: it opens tables with RecordRef and never writes.
/// </summary>
codeunit 90000 "SQM Data Reader"
{
    Access = Internal;

    var
        TableNotFoundErr: Label 'Table "%1" does not exist.', Comment = '%1 = table name written in the query';
        CompanyNotFoundErr: Label 'Company "%1" does not exist.', Comment = '%1 = company name written in the query';
        NoReadPermissionErr: Label 'You do not have permission to read table "%1".', Comment = '%1 = table name';
        InvalidRequestErr: Label 'The query editor sent an invalid data request.';
        MaxRowsPerChunk: Integer;
        MaxCharsPerChunk: Integer;

    /// <summary>Same as ReadTables, returns false instead of raising an error.</summary>
    [TryFunction]
    procedure TryReadTables(RequestJson: Text; MaxSourceRows: Integer; var Chunks: List of [Text])
    begin
        ReadTables(RequestJson, MaxSourceRows, Chunks);
    end;

    /// <summary>
    /// Reads every table in RequestJson ({"tables": [{"key", "company", "table", "allColumns", "columns"}]}).
    /// Each table produces one or more chunks: {"key", "columns": [{"name", "type"}], "rows": [[...]], "last"}.
    /// The last chunk of a table also has "truncated", "rowCount" and "readMs".
    /// MaxSourceRows limits the rows read per table; 0 means no limit.
    /// </summary>
    procedure ReadTables(RequestJson: Text; MaxSourceRows: Integer; var Chunks: List of [Text])
    var
        Request: JsonObject;
        TablesToken: JsonToken;
        TableToken: JsonToken;
    begin
        MaxRowsPerChunk := 5000;
        MaxCharsPerChunk := 2000000;
        if not Request.ReadFrom(RequestJson) then
            Error(InvalidRequestErr);
        if not Request.Get('tables', TablesToken) then
            Error(InvalidRequestErr);
        if not TablesToken.IsArray() then
            Error(InvalidRequestErr);
        foreach TableToken in TablesToken.AsArray() do
            ReadTable(TableToken.AsObject(), MaxSourceRows, Chunks);
    end;

    local procedure ReadTable(TableRequest: JsonObject; MaxSourceRows: Integer; var Chunks: List of [Text])
    var
        RecRef: RecordRef;
        FieldNos: List of [Integer];
        FieldTypes: List of [Text];
        FlowFieldNos: List of [Integer];
        TableKey: Text;
        TableName: Text;
        Company: Text;
        ColumnsJson: Text;
        Rows: TextBuilder;
        StartTime: Time;
        RowCount: Integer;
        ChunkRows: Integer;
        Truncated: Boolean;
    begin
        TableKey := GetText(TableRequest, 'key');
        TableName := GetText(TableRequest, 'table');
        Company := FindCompanyName(GetText(TableRequest, 'company'));

        StartTime := Time();
        if Company = '' then
            RecRef.Open(FindTableNo(TableName))
        else
            RecRef.Open(FindTableNo(TableName), false, Company);
        if not RecRef.ReadPermission() then
            Error(NoReadPermissionErr, TableName);

        SelectFields(RecRef, TableRequest, FieldNos, FieldTypes, FlowFieldNos, ColumnsJson);
        SetLoadFields(RecRef, FieldNos, FlowFieldNos);
        RecRef.ReadIsolation := IsolationLevel::ReadUncommitted;

        if RecRef.FindSet() then
            repeat
                if (MaxSourceRows > 0) and (RowCount >= MaxSourceRows) then
                    Truncated := true
                else begin
                    if ChunkRows > 0 then
                        Rows.Append(',');
                    AppendRow(RecRef, FieldNos, FieldTypes, FlowFieldNos, Rows);
                    RowCount += 1;
                    ChunkRows += 1;
                    if (ChunkRows >= MaxRowsPerChunk) or (Rows.Length() >= MaxCharsPerChunk) then begin
                        Chunks.Add(ChunkJson(TableKey, ColumnsJson, Rows, '"last":false'));
                        Rows.Clear();
                        ChunkRows := 0;
                    end;
                end;
            until Truncated or (RecRef.Next() = 0);

        Chunks.Add(ChunkJson(TableKey, ColumnsJson, Rows,
            StrSubstNo('"last":true,"truncated":%1,"rowCount":%2,"readMs":%3', BoolJson(Truncated), Format(RowCount, 0, 9), Format(ElapsedMs(StartTime), 0, 9))));
        RecRef.Close();
    end;

    local procedure ChunkJson(TableKey: Text; ColumnsJson: Text; var Rows: TextBuilder; Tail: Text): Text
    var
        Chunk: TextBuilder;
    begin
        Chunk.Append('{"key":');
        Chunk.Append(JsonString(TableKey));
        Chunk.Append(',"columns":');
        Chunk.Append(ColumnsJson);
        Chunk.Append(',"rows":[');
        Chunk.Append(Rows.ToText());
        Chunk.Append('],');
        Chunk.Append(Tail);
        Chunk.Append('}');
        exit(Chunk.ToText());
    end;

    local procedure ElapsedMs(StartTime: Time): Integer
    var
        Ms: Integer;
    begin
        Ms := Time() - StartTime;
        if Ms < 0 then // passed midnight
            Ms += 86400000;
        exit(Ms);
    end;

    local procedure BoolJson(Value: Boolean): Text
    begin
        if Value then
            exit('true');
        exit('false');
    end;

    /// <summary>
    /// Chooses the columns to read: all normal fields when the query uses *, plus the fields named in the query.
    /// FlowFields only when named. BLOB, Media, MediaSet and FlowFilter fields are never read.
    /// </summary>
    local procedure SelectFields(var RecRef: RecordRef; TableRequest: JsonObject; var FieldNos: List of [Integer]; var FieldTypes: List of [Text]; var FlowFieldNos: List of [Integer]; var ColumnsJson: Text)
    var
        Field: Record Field;
        FldRef: FieldRef;
        Requested: List of [Text];
        Columns: TextBuilder;
        AllColumns: Boolean;
        IsRequested: Boolean;
        ColumnType: Text;
    begin
        AllColumns := GetBool(TableRequest, 'allColumns');
        GetRequestedColumns(TableRequest, Requested);

        Field.SetRange(TableNo, RecRef.Number());
        Field.SetRange(Enabled, true);
        Field.SetFilter(ObsoleteState, '<>%1', Field.ObsoleteState::Removed);
        if Field.FindSet() then
            repeat
                FldRef := RecRef.Field(Field."No.");
                ColumnType := ColumnTypeOf(FldRef);
                IsRequested := Requested.Contains(LowerCase(Field.FieldName));
                if ColumnType <> '' then
                    case FldRef.Class() of
                        FieldClass::Normal:
                            if AllColumns or IsRequested then
                                AddColumn(Field, ColumnType, FieldNos, FieldTypes, Columns);
                        FieldClass::FlowField:
                            if IsRequested then begin
                                AddColumn(Field, ColumnType, FieldNos, FieldTypes, Columns);
                                FlowFieldNos.Add(Field."No.");
                            end;
                    end;
            until Field.Next() = 0;
        ColumnsJson := '[' + Columns.ToText() + ']';
    end;

    local procedure AddColumn(Field: Record Field; ColumnType: Text; var FieldNos: List of [Integer]; var FieldTypes: List of [Text]; var Columns: TextBuilder)
    begin
        if FieldNos.Count() > 0 then
            Columns.Append(',');
        Columns.Append('{"name":');
        Columns.Append(JsonString(Field.FieldName));
        Columns.Append(',"type":"');
        if ColumnType = 'opt' then
            Columns.Append('int') // options and enums are integers in the database
        else
            Columns.Append(ColumnType);
        Columns.Append('"}');
        FieldNos.Add(Field."No.");
        FieldTypes.Add(ColumnType);
    end;

    /// <summary>Column type understood by the add-in; empty for fields that are not read.</summary>
    local procedure ColumnTypeOf(FldRef: FieldRef): Text
    begin
        if FldRef.Class() = FieldClass::FlowFilter then
            exit('');
        case FldRef.Type() of
            FieldType::Blob, FieldType::Media, FieldType::MediaSet, FieldType::TableFilter:
                exit('');
            FieldType::Code, FieldType::Text:
                exit('text');
            FieldType::Integer, FieldType::BigInteger:
                exit('int');
            FieldType::Option:
                exit('opt');
            FieldType::Decimal:
                exit('dec');
            FieldType::Boolean:
                exit('bool');
            FieldType::Date:
                exit('date');
            FieldType::DateTime:
                exit('datetime');
            FieldType::Time:
                exit('time');
            FieldType::Guid:
                exit('guid');
            else
                exit('text');
        end;
    end;

    local procedure SetLoadFields(var RecRef: RecordRef; FieldNos: List of [Integer]; FlowFieldNos: List of [Integer])
    var
        FieldNo: Integer;
        Added: Boolean;
    begin
        foreach FieldNo in FieldNos do
            if not FlowFieldNos.Contains(FieldNo) then begin
                RecRef.AddLoadFields(FieldNo);
                Added := true;
            end;
        if not Added then // only FlowFields requested: load just the primary key
            RecRef.AddLoadFields(RecRef.KeyIndex(1).FieldIndex(1).Number());
    end;

    local procedure AppendRow(var RecRef: RecordRef; FieldNos: List of [Integer]; FieldTypes: List of [Text]; FlowFieldNos: List of [Integer]; var Rows: TextBuilder)
    var
        FldRef: FieldRef;
        FieldNo: Integer;
        i: Integer;
    begin
        foreach FieldNo in FlowFieldNos do begin
            FldRef := RecRef.Field(FieldNo);
            FldRef.CalcField();
        end;
        Rows.Append('[');
        for i := 1 to FieldNos.Count() do begin
            if i > 1 then
                Rows.Append(',');
            FldRef := RecRef.Field(FieldNos.Get(i));
            Rows.Append(ValueJson(FldRef, FieldTypes.Get(i)));
        end;
        Rows.Append(']');
    end;

    /// <summary>
    /// Value as JSON, written the way SQL Server stores it for Business Central:
    /// booleans as 0/1, options and enums as integers, blank dates as 1753-01-01.
    /// </summary>
    local procedure ValueJson(FldRef: FieldRef; ColumnType: Text): Text
    var
        IntValue: BigInteger;
        DecValue: Decimal;
        BoolValue: Boolean;
        DateValue: Date;
        DateTimeValue: DateTime;
        TimeValue: Time;
        GuidValue: Guid;
    begin
        case ColumnType of
            'int':
                begin
                    IntValue := FldRef.Value();
                    exit(Format(IntValue, 0, 9));
                end;
            'opt':
                exit(Format(FldRef.Value(), 0, '<Number>'));
            'dec':
                begin
                    DecValue := FldRef.Value();
                    exit(Format(DecValue, 0, 9));
                end;
            'bool':
                begin
                    BoolValue := FldRef.Value();
                    if BoolValue then
                        exit('1');
                    exit('0');
                end;
            'date':
                begin
                    DateValue := FldRef.Value();
                    if DateValue = 0D then
                        exit('"1753-01-01"');
                    exit('"' + Format(NormalDate(DateValue), 0, 9) + '"');
                end;
            'datetime':
                begin
                    DateTimeValue := FldRef.Value();
                    if DateTimeValue = 0DT then
                        exit('"1753-01-01 00:00:00.000"');
                    exit('"' + Format(DateTimeValue, 0, 9).Replace('T', ' ').TrimEnd('Z') + '"');
                end;
            'time':
                begin
                    TimeValue := FldRef.Value();
                    if TimeValue = 0T then
                        exit('null');
                    exit('"' + Format(TimeValue, 0, 9).TrimEnd('Z') + '"');
                end;
            'guid':
                begin
                    GuidValue := FldRef.Value();
                    exit('"' + DelChr(Format(GuidValue), '=', '{}') + '"');
                end;
            else
                exit(JsonString(Format(FldRef.Value())));
        end;
    end;

    /// <summary>Finds a table by its AL name; also accepts the SQL Server form ("Cust_ Ledger Entry"). Case-insensitive.</summary>
    local procedure FindTableNo(TableName: Text): Integer
    var
        AllObj: Record AllObjWithCaption;
    begin
        AllObj.SetRange("Object Type", AllObj."Object Type"::Table);
        if StrLen(TableName) <= MaxStrLen(AllObj."Object Name") then begin
            AllObj.SetRange("Object Name", TableName);
            if AllObj.FindFirst() then
                exit(AllObj."Object ID");
            AllObj.SetRange("Object Name");
        end;
        if AllObj.FindSet() then
            repeat
                if SameName(AllObj."Object Name", TableName) then
                    exit(AllObj."Object ID");
            until AllObj.Next() = 0;
        Error(TableNotFoundErr, TableName);
    end;

    /// <summary>Exact company name for the name written in the query; empty for the current company.</summary>
    local procedure FindCompanyName(Name: Text): Text
    var
        Company: Record Company;
    begin
        if Name = '' then
            exit('');
        if StrLen(Name) <= MaxStrLen(Company.Name) then
            if Company.Get(Name) then
                exit(Company.Name);
        if Company.FindSet() then
            repeat
                if SameName(Company.Name, Name) then
                    exit(Company.Name);
            until Company.Next() = 0;
        Error(CompanyNotFoundErr, Name);
    end;

    /// <summary>Case-insensitive comparison that also accepts the SQL Server form of a name, where . " \ / ' become _.</summary>
    local procedure SameName(BcName: Text; WrittenName: Text): Boolean
    begin
        if LowerCase(BcName) = LowerCase(WrittenName) then
            exit(true);
        exit(LowerCase(ConvertStr(BcName, '."\/''', '_____')) = LowerCase(WrittenName));
    end;

    local procedure GetRequestedColumns(TableRequest: JsonObject; var Requested: List of [Text])
    var
        ColumnsToken: JsonToken;
        ColumnToken: JsonToken;
    begin
        if not TableRequest.Get('columns', ColumnsToken) then
            exit;
        if not ColumnsToken.IsArray() then
            exit;
        foreach ColumnToken in ColumnsToken.AsArray() do
            if ColumnToken.IsValue() then
                Requested.Add(LowerCase(ColumnToken.AsValue().AsText()));
    end;

    local procedure GetText(JObject: JsonObject; PropertyName: Text): Text
    var
        Token: JsonToken;
    begin
        if not JObject.Get(PropertyName, Token) then
            exit('');
        if not Token.IsValue() then
            exit('');
        if Token.AsValue().IsNull() then
            exit('');
        exit(Token.AsValue().AsText());
    end;

    local procedure GetBool(JObject: JsonObject; PropertyName: Text): Boolean
    var
        Token: JsonToken;
    begin
        if not JObject.Get(PropertyName, Token) then
            exit(false);
        if not Token.IsValue() then
            exit(false);
        if Token.AsValue().IsNull() then
            exit(false);
        exit(Token.AsValue().AsBoolean());
    end;

    /// <summary>Text as a JSON string literal, with quotes and escapes.</summary>
    local procedure JsonString(Value: Text): Text
    var
        Cr: Text[1];
        Lf: Text[1];
        Tab: Text[1];
    begin
        Cr[1] := 13;
        Lf[1] := 10;
        Tab[1] := 9;
        exit('"' + Value.Replace('\', '\\').Replace('"', '\"').Replace(Cr, '\r').Replace(Lf, '\n').Replace(Tab, '\t') + '"');
    end;
}
