import * as vscode from "vscode";
import { DocumentManager } from "../utils/document";
import { vscodePositionToPosition, Position, Range } from "../utils/position";
import * as AST from "../parser/ast";
import { TypeInference } from "../analysis/type_inference";

export class HoverProvider implements vscode.HoverProvider {
    private documentManager: DocumentManager;
    private typeInference: TypeInference;

    constructor(documentManager: DocumentManager) {
        this.documentManager = documentManager;
        this.typeInference = new TypeInference();
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const parseResult = this.documentManager.parse(document);
        const pos = vscodePositionToPosition(position);

        const node = this.findNodeAtPosition(parseResult.program, pos);
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

        if (name === "__namespace__") {
            const md = new vscode.MarkdownString();
            md.appendCodeblock("__namespace__", "comet");
            md.appendMarkdown("\n\n" + vscode.l10n.t("Resolves to the module path. In the main file, equals the configured namespace; in imported modules, becomes `namespace:filename/`."));
            return new vscode.Hover(md);
        }
        if (name === "__main__") {
            const md = new vscode.MarkdownString();
            md.appendCodeblock("__main__", "comet");
            md.appendMarkdown("\n\n" + vscode.l10n.t("Always resolves to the configured root namespace, regardless of which file it appears in."));
            return new vscode.Hover(md);
        }

        const scope = parseResult.scope.findScope(pos);
        const symbol = scope.resolve(name, pos);
        if (!symbol) {
            return null;
        }

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        switch (symbol.kind) {
            case "function":
                let funcReturnTypeStr = symbol.returnType || "";
                if (!funcReturnTypeStr) {
                    const funcNode = this.findFuncDeclarationNode(
                        parseResult.program,
                        symbol.declarationRange
                    );
                    if (funcNode) {
                        funcReturnTypeStr = this.typeInference.inferReturnType(
                            funcNode,
                            parseResult.scope
                        );
                    }
                }

                const funcSignature = `def ${symbol.name}(${this.formatParams(symbol.params || [])})`;
                const funcReturnType = funcReturnTypeStr
                    ? ` → ${funcReturnTypeStr}`
                    : "";
                markdown.appendCodeblock(funcSignature + funcReturnType, "comet");
                if (symbol.documentation) {
                    markdown.appendMarkdown("\n\n" + symbol.documentation);
                }
                break;

            case "builtin":
                const signature = `${symbol.name}(${this.formatParams(symbol.params || [])})`;
                const returnType = symbol.returnType
                    ? ` → ${symbol.returnType}`
                    : "";
                markdown.appendCodeblock(signature + returnType, "comet");
                if (symbol.documentation) {
                    markdown.appendMarkdown("\n\n" + vscode.l10n.t(symbol.documentation));
                }
                break;

            case "variable":
                let typeStr = symbol.returnType || "any";

                if (typeStr === "any") {
                    const declNode = this.findDeclarationNode(
                        parseResult.program,
                        symbol.originalRange || symbol.declarationRange
                    );
                    if (declNode && declNode.init) {
                        typeStr = this.typeInference.infer(
                            declNode.init,
                            parseResult.scope
                        );
                    }
                }

                let displayStr = `var ${symbol.name}: ${typeStr}`;
                if (symbol.value !== undefined) {
                    displayStr += ` = ${symbol.value}`;
                }

                markdown.appendCodeblock(displayStr, "comet");
                if (symbol.documentation) {
                    markdown.appendMarkdown("\n\n" + symbol.documentation);
                }
                const varLine =
                    (symbol.originalRange || symbol.declarationRange).start.line + 1;
                markdown.appendMarkdown(
                    `\n\n${vscode.l10n.t("Declared at line {0}", varLine)}`
                );
                break;

            case "parameter":
                markdown.appendCodeblock(`parameter ${symbol.name}`, "comet");
                break;

            case "import":
                markdown.appendCodeblock(`import ${symbol.name}`, "comet");
                markdown.appendMarkdown(
                    `\n\n${vscode.l10n.t("Imported module")}`
                );
                break;

            case "score":
                markdown.appendCodeblock(
                    `score ${symbol.name} (${symbol.scope})`,
                    "comet"
                );
                markdown.appendMarkdown(
                    `\n\n${vscode.l10n.t("Scoreboard objective: {0}", symbol.scope || "")}`
                );
                break;

            case "tag":
                markdown.appendCodeblock(`tag ${symbol.name}`, "comet");
                markdown.appendMarkdown(`\n\n${vscode.l10n.t("Entity tag")}`);
                break;

            case "storage":
                markdown.appendCodeblock(`storage ${symbol.name}`, "comet");
                markdown.appendMarkdown(`\n\n${vscode.l10n.t("Command storage")}`);
                break;

            default:
                return null;
        }

        return new vscode.Hover(markdown);
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

    private formatParams(params: any[]): string {
        return params
            .map(p => (p.type ? `${p.name}: ${p.type}` : p.name))
            .join(", ");
    }

    private findFuncDeclarationNode(
        program: AST.Program,
        range: Range
    ): AST.FuncDeclaration | null {
        let found: AST.FuncDeclaration | null = null;

        const visit = (node: any) => {
            if (found) return;
            if (!node || typeof node !== "object") return;

            if (
                node.type === "FuncDeclaration" &&
                node.name &&
                node.name.range
            ) {
                const r = node.name.range;
                if (
                    r.start.line === range.start.line &&
                    r.start.character === range.start.character
                ) {
                    found = node;
                    return;
                }
            }

            for (const key in node) {
                if (key === "range" || key === "type") continue;
                const val = node[key];
                if (Array.isArray(val)) val.forEach(visit);
                else if (typeof val === "object") visit(val);
            }
        };

        visit(program);
        return found;
    }

    private findDeclarationNode(
        program: AST.Program,
        range: Range
    ): AST.VarDeclaration | null {
        let found: AST.VarDeclaration | null = null;

        const visit = (node: any) => {
            if (found) return;
            if (!node || typeof node !== "object") return;

            if (
                node.type === "VarDeclaration" &&
                node.name &&
                node.name.range
            ) {
                const r = node.name.range;
                if (
                    r.start.line === range.start.line &&
                    r.start.character === range.start.character
                ) {
                    found = node;
                    return;
                }
            }

            for (const key in node) {
                if (key === "range" || key === "type") continue;
                const val = node[key];
                if (Array.isArray(val)) val.forEach(visit);
                else if (typeof val === "object") visit(val);
            }
        };

        visit(program);
        return found;
    }
}
