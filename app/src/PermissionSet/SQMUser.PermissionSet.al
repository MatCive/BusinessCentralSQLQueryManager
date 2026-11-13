/// <summary>
/// Use of SQL Query Manager. Reading the data itself still needs the user's own permissions on each table.
/// </summary>
permissionset 90000 "SQM User"
{
    Caption = 'SQL Query Manager';
    Assignable = true;

    Permissions =
        page "SQM SQL Query Manager" = X,
        codeunit "SQM Data Reader" = X,
        tabledata AllObjWithCaption = R,
        tabledata Company = R,
        tabledata Field = R;
}
