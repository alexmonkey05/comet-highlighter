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

        const node = this.findNodeAtPosition(
            parseResult.program,
            pos
        );
        if (!node) {
            return null;
        }

        let name = "";
        if (node.type === "Identifier") {
            name = node.name;
        } else if (node.type === "StringLiteral") {
            name = node.value;
        } else {
            return null;
        }

        const symbol = parseResult.scope.resolve(name);
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
            rangeToVscodeRange(symbol.declarationRange)
        );
    }

    private findNodeAtPosition(
        program: AST.Program,
        pos: Position
    ): AST.Identifier | AST.StringLiteral | null {
        let found: any = null;

        const visitNode = (node: any): void => {
            if (!node || typeof node !== "object") return;

            if ((node.type === "Identifier" || node.type === "StringLiteral") && node.range) {
                if (this.rangeContainsPosition(node.range, pos)) {
                    found = node;
                }
            }

            for (const key in node) {
                if (key === "range" || key === "type") continue;
                const value = node[key];

                if (Array.isArray(value)) {
                    for (const item of value) {
                        visitNode(item);
                    }
                } else if (typeof value === "object") {
                    visitNode(value);
                }
            }
        };

        visitNode(program);
        return found;
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
