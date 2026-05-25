import * as vscode from "vscode";
import { DocumentManager } from "../utils/document";
import { vscodePositionToPosition, Position } from "../utils/position";
import * as AST from "../parser/ast";
import { TypeInference } from "../analysis/type_inference";

export class InlayHintProvider implements vscode.InlayHintsProvider {
    private documentManager: DocumentManager;
    private typeInference: TypeInference;

    constructor(documentManager: DocumentManager) {
        this.documentManager = documentManager;
        this.typeInference = new TypeInference();
    }

    provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlayHint[]> {
        const parseResult = this.documentManager.parse(document);
        const hints: vscode.InlayHint[] = [];

        const visitNode = (node: any): void => {
            if (!node || typeof node !== "object") return;

            if (node.type === "VarDeclaration") {
                if (!node.varType && node.init) {
                    const type = this.typeInference.infer(node.init, parseResult.scope);
                    if (type !== "any") {
                        const position = new vscode.Position(
                            node.name.range.end.line,
                            node.name.range.end.character
                        );
                        const hint = new vscode.InlayHint(
                            position,
                            `: ${type}`,
                            vscode.InlayHintKind.Type
                        );
                        hints.push(hint);
                    }
                }
            } else if (node.type === "FuncDeclaration") {
                if (!node.returnType) {
                    const symbol = parseResult.scope.resolveLocal(node.name.name);
                    const type = symbol?.returnType || this.typeInference.inferReturnType(node, parseResult.scope);
                    
                    if (type && type !== "any") {
                        const bodyStart = node.body.range.start;
                        const finalHintPos = new vscode.Position(
                            bodyStart.line,
                            bodyStart.character
                        );

                        // Check if there's a space before the opening brace in the source code
                        const lineText = document.lineAt(bodyStart.line).text;
                        const hasLeadingSpace = bodyStart.character > 0 && lineText[bodyStart.character - 1] === " ";
                        const label = hasLeadingSpace ? `→ ${type} ` : ` → ${type} `;

                        const hint = new vscode.InlayHint(
                            finalHintPos,
                            label,
                            vscode.InlayHintKind.Type
                        );
                        hints.push(hint);
                    }
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

        visitNode(parseResult.program);
        return hints;
    }
}
