import * as vscode from "vscode";
import { DocumentManager } from "../utils/document";
import { rangeToVscodeRange } from "../utils/position";
import * as AST from "../parser/ast";

export class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private documentManager: DocumentManager;

    constructor(documentManager: DocumentManager) {
        this.documentManager = documentManager;
    }

    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<
        vscode.SymbolInformation[] | vscode.DocumentSymbol[]
    > {
        const parseResult = this.documentManager.parse(document);
        const symbols: vscode.DocumentSymbol[] = [];

        for (const stmt of parseResult.program.body) {
            symbols.push(...this.visitStatement(stmt));
        }

        return symbols;
    }

    private visitStatement(node: AST.Statement): vscode.DocumentSymbol[] {
        switch (node.type) {
            case "VarDeclaration":
                return [this.createSymbol(
                    node.name.name,
                    vscode.SymbolKind.Variable,
                    node.range,
                    node.name.range
                )];

            case "FuncDeclaration": {
                const funcSymbol = this.createSymbol(
                    node.name.name,
                    vscode.SymbolKind.Function,
                    node.range,
                    node.name.range
                );

                for (const param of node.params) {
                    const paramSymbol = this.createSymbol(
                        param.name.name,
                        vscode.SymbolKind.Variable,
                        param.range,
                        param.name.range
                    );
                    funcSymbol.children.push(paramSymbol);
                }

                for (const stmt of node.body.body) {
                    funcSymbol.children.push(...this.visitStatement(stmt));
                }

                return [funcSymbol];
            }

            case "ImportStatement":
                return [this.createSymbol(
                    node.source.name,
                    vscode.SymbolKind.Module,
                    node.range,
                    node.source.range
                )];

            case "IfStatement": {
                const ifChildren: vscode.DocumentSymbol[] = [];

                if (node.consequent.type === "BlockStatement") {
                    for (const stmt of node.consequent.body) {
                        ifChildren.push(...this.visitStatement(stmt));
                    }
                }

                for (const elseIf of node.elseIfClauses) {
                    if (elseIf.consequent.type === "BlockStatement") {
                        for (const stmt of elseIf.consequent.body) {
                            ifChildren.push(...this.visitStatement(stmt));
                        }
                    }
                }

                if (
                    node.alternate &&
                    node.alternate.type === "BlockStatement"
                ) {
                    for (const stmt of node.alternate.body) {
                        ifChildren.push(...this.visitStatement(stmt));
                    }
                }

                return ifChildren;
            }

            case "WhileStatement": {
                if (node.body.type === "BlockStatement") {
                    const whileChildren: vscode.DocumentSymbol[] = [];
                    for (const stmt of node.body.body) {
                        whileChildren.push(...this.visitStatement(stmt));
                    }
                    return whileChildren;
                }
                return [];
            }

            case "BlockStatement": {
                const blockChildren: vscode.DocumentSymbol[] = [];
                for (const stmt of node.body) {
                    blockChildren.push(...this.visitStatement(stmt));
                }
                return blockChildren;
            }

            case "ExecuteStatement": {
                const execChildren: vscode.DocumentSymbol[] = [];
                for (const stmt of node.body.body) {
                    execChildren.push(...this.visitStatement(stmt));
                }
                return execChildren;
            }

            default:
                return [];
        }
    }

    private createSymbol(
        name: string,
        kind: vscode.SymbolKind,
        range: AST.Range,
        selectionRange: AST.Range
    ): vscode.DocumentSymbol {
        return new vscode.DocumentSymbol(
            name,
            "",
            kind,
            rangeToVscodeRange(range),
            rangeToVscodeRange(selectionRange)
        );
    }
}
