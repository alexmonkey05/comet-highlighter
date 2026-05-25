import * as vscode from "vscode";
import { DocumentManager } from "../utils/document";
import {
    vscodePositionToPosition,
    rangeToVscodeRange,
    Position,
    Range,
} from "../utils/position";
import * as AST from "../parser/ast";

export class DefinitionProvider implements vscode.DefinitionProvider {
    private documentManager: DocumentManager;

    constructor(documentManager: DocumentManager) {
        this.documentManager = documentManager;
    }

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const parseResult = this.documentManager.parse(document);
        const pos = vscodePositionToPosition(position);

        const nodeInfo = this.findNodeAndParentAtPosition(
            parseResult.program,
            pos
        );
        if (!nodeInfo) {
            return null;
        }

        const { node, parent } = nodeInfo;

        let name = "";
        if (node.type === "Identifier") {
            name = node.name;
        } else if (node.type === "StringLiteral") {
            name = node.value;
        } else {
            return null;
        }

        const scope = parseResult.scope.findScope(pos);
        
        // 문맥에 따른 SymbolKind 추론
        let preferredKind: import("../analysis/scope").SymbolKind | undefined;
        if (parent) {
            if (parent.type === "CallExpression" && parent.callee === node) {
                preferredKind = "function";
            } else if (parent.type === "MemberExpression" && parent.object === node) {
                preferredKind = "import";
            } else if (parent.type === "ImportStatement") {
                preferredKind = "import";
            } else if (parent.type === "FuncDeclaration" && parent.name === node) {
                preferredKind = "function";
            } else if (parent.type === "VarDeclaration" && parent.name === node) {
                preferredKind = "variable";
            }
        }

        let symbol = scope.resolve(name, pos, preferredKind);
        
        // 함수 선언부의 경우 현재 스코프 범위(pos) 검사에 걸리지 않아 resolveLocal을 추가로 시도
        if (!symbol && preferredKind === "function" && parent?.type === "FuncDeclaration") {
             symbol = parseResult.scope.resolveLocal(name, undefined, "function");
        }

        if (!symbol || symbol.kind === "builtin") {
            return null;
        }

        if (symbol.kind === "import") {
            const importedFile = vscode.Uri.joinPath(
                document.uri,
                "..",
                `${symbol.name}.planet`
            );
            return new vscode.Location(importedFile, new vscode.Position(0, 0));
        }

        return new vscode.Location(
            document.uri,
            rangeToVscodeRange(symbol.originalRange || symbol.declarationRange)
        );
    }

    private findNodeAndParentAtPosition(
        program: AST.Program,
        pos: Position
    ): { node: AST.Identifier | AST.StringLiteral; parent: any } | null {
        let found: any = null;
        let foundParent: any = null;

        const visitNode = (node: any, parent: any = null): void => {
            if (!node || typeof node !== "object") return;

            if ((node.type === "Identifier" || node.type === "StringLiteral") && node.range) {
                if (this.rangeContainsPosition(node.range, pos)) {
                    found = node;
                    foundParent = parent;
                }
            }

            for (const key in node) {
                if (key === "range" || key === "type") continue;
                const value = node[key];

                if (Array.isArray(value)) {
                    for (const item of value) {
                        visitNode(item, node);
                    }
                } else if (typeof value === "object") {
                    visitNode(value, node);
                }
            }
        };

        visitNode(program);
        if (found) {
            return { node: found, parent: foundParent };
        }
        return null;
    }

    private rangeContainsPosition(range: Range, pos: Position): boolean {
        if (pos.line < range.start.line || pos.line > range.end.line) {
            return false;
        }
        if (
            pos.line === range.start.line &&
            pos.character < range.start.character
        ) {
            return false;
        }
        if (
            pos.line === range.end.line &&
            pos.character > range.end.character
        ) {
            return false;
        }
        return true;
    }
}
