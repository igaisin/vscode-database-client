import * as path from "path";
import * as vscode from "vscode";
import mysqldump from 'mysqldump'
import { QueryUnit } from "../../database/QueryUnit";
import { ColumnNode } from "./columnNode";
import { InfoNode } from "../InfoNode";
import { INode } from "../INode";
import { DatabaseCache } from "../../database/DatabaseCache";
import { ModelType, Constants } from "../../common/Constants";
import { IConnection } from "../Connection";
import { Console } from "../../common/OutputChannel";
import { ConnectionManager } from "../../database/ConnectionManager";
import { MySQLTreeDataProvider } from "../../provider/MysqlTreeDataProvider";


export class TableNode implements INode, IConnection {

    identify: string;
    type: string = ModelType.TABLE;

    constructor(readonly host: string, readonly user: string, readonly password: string,
        readonly port: string, readonly database: string, readonly table: string,
        readonly certPath: string) {
        this.identify = `${this.host}_${this.port}_${this.user}_${this.database}_${this.table}`
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            label: this.table,
            collapsibleState: DatabaseCache.getElementState(this),
            contextValue: ModelType.TABLE,
            iconPath: path.join(Constants.RES_PATH, "table.svg"),
            command: {
                command: "mysql.template.sql",
                title: "Run Select Statement",
                arguments: [this, true]
            }
        };

    }

    public async getChildren(isRresh: boolean = false): Promise<INode[]> {
        let columnNodes = DatabaseCache.getColumnListOfTable(this.identify)
        if (columnNodes && !isRresh) {
            return columnNodes;
        }
        return QueryUnit.queryPromise<any[]>(await ConnectionManager.getConnection(this), `SELECT COLUMN_NAME,COLUMN_TYPE,COLUMN_COMMENT,COLUMN_TYPE,COLUMN_KEY FROM information_schema.columns WHERE table_schema = '${this.database}' AND table_name = '${this.table}';`)
            .then((columns) => {
                columnNodes = columns.map<ColumnNode>((column) => {
                    return new ColumnNode(this.host, this.user, this.password, this.port, this.database, this.table, this.certPath, column);
                })
                DatabaseCache.setColumnListOfTable(this.identify, columnNodes)

                return columnNodes;
            })
            .catch((err) => {
                return [new InfoNode(err)];
            });
    }


    public changeTableName() {

        vscode.window.showInputBox({ value: this.table, placeHolder: 'newTableName', prompt: `You will changed ${this.database}.${this.table} to new table name!` }).then(async newTableName => {
            if (!newTableName) return
            const sql = `RENAME TABLE \`${this.database}\`.\`${this.table}\` to \`${this.database}\`.\`${newTableName}\``
            QueryUnit.queryPromise(await ConnectionManager.getConnection(this), sql).then((rows) => {
                DatabaseCache.clearTableCache(`${this.host}_${this.port}_${this.user}_${this.database}`)
                MySQLTreeDataProvider.refresh()
            })

        })

    }

    public dropTable() {

        vscode.window.showInputBox({ prompt: `Are you want to drop table ${this.table} ?     `, placeHolder: 'Input y to confirm.' }).then(async inputContent => {
            if(!inputContent)return;
            if (inputContent.toLocaleLowerCase() == 'y') {
                QueryUnit.queryPromise(await ConnectionManager.getConnection(this), `DROP TABLE \`${this.database}\`.\`${this.table}\``).then(() => {
                    DatabaseCache.clearTableCache(`${this.host}_${this.port}_${this.user}_${this.database}`)
                    MySQLTreeDataProvider.refresh()
                    vscode.window.showInformationMessage(`Drop table ${this.table} success!`)
                })
            } else {
                vscode.window.showInformationMessage(`Cancel drop table ${this.table}!`)
            }
        })

    }


    truncateTable() {

        vscode.window.showInputBox({ prompt: `Are you want to clear table ${this.table} all data ?          `, placeHolder: 'Input y to confirm.' }).then(async inputContent => {
            if(!inputContent)return;
            if (inputContent.toLocaleLowerCase() == 'y') {
                QueryUnit.queryPromise(await ConnectionManager.getConnection(this), `truncate table \`${this.database}\`.\`${this.table}\``).then(() => {
                    vscode.window.showInformationMessage(`Clear table ${this.table} all data success!`)
                })
            }
        })


    }

    indexTemplate() {
        ConnectionManager.getConnection(this, true)
        QueryUnit.showSQLTextDocument(`-- ALTER TABLE \`${this.database}\`.\`${this.table}\` DROP INDEX [indexName];
-- ALTER TABLE \`${this.database}\`.\`${this.table}\` ADD [UNIQUE|KEY|PRIMARY KEY] INDEX ([column]);`)
        setTimeout(() => {
            QueryUnit.runQuery(`SELECT column_name,table_schema,index_name,non_unique FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema='${this.database}' and table_name='${this.table}';`, this)
        }, 10);

    }


    public async selectSqlTemplate(run: Boolean) {
        const sql = `SELECT * FROM \`${this.database}\`.\`${this.table}\` LIMIT ${Constants.DEFAULT_SIZE};`;

        if (run) {
            ConnectionManager.getConnection(this, true)
            QueryUnit.runQuery(sql, this);
        } else {
            QueryUnit.createSQLTextDocument(sql);
        }

    }

    public insertSqlTemplate() {
        this
            .getChildren()
            .then((children: INode[]) => {
                const childrenNames = children.map((child: any) => child.column.COLUMN_NAME);
                let sql = `insert into ${this.database}.{this.table}\n`
                sql += `(${childrenNames.toString().replace(/,/g, ", ")})\n`
                sql += "values\n"
                sql += `('${childrenNames.toString().replace(/,/g, ", ")}');`
                QueryUnit.createSQLTextDocument(sql);
            });
    }

    deleteSqlTemplate(): any {
        this
            .getChildren()
            .then((children: INode[]) => {
                const keysNames = children.filter((child: any) => child.column.COLUMN_KEY).map((child: any) => child.column.COLUMN_NAME);

                const where = keysNames.map((name: string) => `${name} = ${name}`);

                let sql = `delete from ${this.database}.${this.table} \n`;
                sql += `where ${where.toString().replace(/,/g, "\n   and ")}`
                QueryUnit.createSQLTextDocument(sql)
            });
    }

    public updateSqlTemplate() {
        this
            .getChildren()
            .then((children: INode[]) => {
                const keysNames = children.filter((child: any) => child.column.COLUMN_KEY).map((child: any) => child.column.COLUMN_NAME);
                const childrenNames = children.filter((child: any) => !child.column.COLUMN_KEY).map((child: any) => child.column.COLUMN_NAME);

                const sets = childrenNames.map((name: string) => `${name} = ${name}`);
                const where = keysNames.map((name: string) => `${name} = '${name}'`);

                let sql = `update ${this.database}.${this.table} \nset ${sets.toString().replace(/,/g, "\n  , ")}\n`;
                sql += `where ${where.toString().replace(/,/g, "\n   and ")}`
                QueryUnit.createSQLTextDocument(sql)
            });
    }

    public backupData(exportPath: string) {

        Console.log(`Doing backup ${this.host}_${this.database}_${this.table}...`)
        mysqldump({
            connection: {
                host: this.host,
                user: this.user,
                password: this.password,
                database: this.database,
                port: parseInt(this.port)
            },
            dump: {
                tables: [this.table],
                schema: {
                    table: {
                        ifNotExist: false,
                        dropIfExist: true,
                        charset: false
                    },
                    engine: false
                }
            },
            dumpToFile: `${exportPath}\\${this.database}.${this.table}_${this.host}.sql`
        }).then(() => {
            vscode.window.showInformationMessage(`Backup ${this.host}_${this.database}_${this.table} success!`)
        }).catch((err) => {
            vscode.window.showErrorMessage(`Backup ${this.host}_${this.database}_${this.table} fail!\n${err}`)
        })
        Console.log("backup end.")

    }


}
