import * as vscode from "vscode";
import { FieldInfo } from "mysql2";
import * as fs from "fs";
import { Console } from "../../common/Console";
import { ExportContext, ExportType } from "./exportContext";
import { ProgressLocation } from "vscode";
import { ConnectionManager } from "../connectionManager";

export class ExportService {

    public export(context: ExportContext): Thenable<any> {
        const randomFileName = `${new Date().getTime()}.${context.type}`

        return vscode.window.showSaveDialog({ saveLabel: "Select export file path", defaultUri: vscode.Uri.file(randomFileName), filters: { 'file': [context.type] } }).then((filePath) => {
            return new Promise((res, rej) => {
                if (filePath) {
                    context.exportPath = filePath.fsPath;
                    if (context.withOutLimit) {
                        context.sql = context.sql.replace(/\blimit\b.+/gi, "")
                    }
                    vscode.window.withProgress({ title: `Start exporting data to ${context.type}...`, location: ProgressLocation.Notification }, () => {
                        return new Promise((resolve) => {
                            context.done = resolve
                            try {
                                this.exportData(context)
                            } catch (error) {
                                resolve(null)
                            } finally {
                                res(null)
                            }
                        })
                    })
                } else {
                    res(null)
                }
            })
        })
    }


    private async exportData(exportOption: ExportContext) {

        const sql = exportOption.sql
        const connection = await ConnectionManager.getConnection(exportOption.dbOption)
        connection.query(sql, (err, rows, fields?: FieldInfo[]) => {
            if (err) {
                Console.log(err)
                return;
            }
            exportOption.fields = fields;
            exportOption.rows = rows;
            this.delegateExport(exportOption, rows, fields)
        })

    }

    private delegateExport(context: ExportContext, rows: any, fields: FieldInfo[]) {
        const filePath = context.exportPath;
        switch (context.type) {
            case ExportType.excel:
                this.exportByNodeXlsx(filePath, fields, rows);
                break;
            case ExportType.csv:
                this.exportToCsv(filePath, fields, rows);
                break;
            case ExportType.json:
                this.exportToJson(context);
                break;
            case ExportType.sql:
                this.exportToSql(context);
                break;
        }
        context.done()
        vscode.window.showInformationMessage(`export ${context.type} success, path is ${context.exportPath}!`, 'Open').then(action => {
            if (action) {
                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(context.exportPath));
            }
        })

    }

    private exportToJson(context: ExportContext) {
        fs.writeFileSync(context.exportPath, JSON.stringify(context.rows, null, 2));
    }

    private exportToSql(exportContext: ExportContext) {

        const { rows, exportPath } = exportContext;
        if (rows.length == 0) {
            // show waraing
            return;
        }

        let sql = ``;
        for (const row of rows) {
            let columns = "";
            let values = "";
            for (const key in row) {
                columns += `${key},`
                values += `'${row[key]}',`
            }
            sql += `insert into ${exportContext.table}(${columns.replace(/.$/, '')}) values(${values.replace(/.$/, '')});\n`
        }
        fs.writeFileSync(exportPath, sql);


    }

    private exportByNodeXlsx(filePath: string, fields: FieldInfo[], rows: any) {
        const nodeXlsx = require('node-xlsx');
        fs.writeFileSync(filePath, nodeXlsx.build([{
            name: "sheet1",
            data: [
                fields.map((field) => field.name),
                ...rows.map((row) => {
                    const values = [];
                    for (const key in row) {
                        values.push(row[key]);
                    }
                    return values;
                })
            ]
        }]), "binary");
    }

    private exportToCsv(filePath: string, fields: FieldInfo[], rows: any) {
        let csvContent = "";
        for (const row of rows) {
            for (const key in row) {
                csvContent += `${row[key]},`
            }
            csvContent = csvContent.replace(/.$/, "") + "\n"
        }
        fs.writeFileSync(filePath, csvContent, { encoding: "utf8" });
    }


}