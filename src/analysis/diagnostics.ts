import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as AST from "../parser/ast";
import { Scope, ScopeAnalyzer } from "./scope";
import { ParseError } from "../parser/parser";
import { rangeToVscodeRange, Range } from "../utils/position";
import {
    getSpyglassManager,
    CommandValidationError,
} from "../minecraft/spyglass";

export interface Diagnostic {
    range: vscode.Range;
    message: string;
    severity: vscode.DiagnosticSeverity;
    source: string;
}

export class DiagnosticGenerator {
    private diagnostics: Diagnostic[] = [];
    private scopeAnalyzer: ScopeAnalyzer;
    private globalScope: Scope | null = null;
    private currentScope: Scope | null = null;
    private inLoop = 0;
    private inFunction = 0;
    private currentUri: vscode.Uri | null = null;

    constructor() {
        this.scopeAnalyzer = new ScopeAnalyzer();
    }

    generate(
        program: AST.Program,
        parserErrors: ParseError[],
        documentText: string = "",
        documentUri?: vscode.Uri
    ): vscode.Diagnostic[] {
        this.diagnostics = [];
        this.inLoop = 0;
        this.inFunction = 0;
        this.documentText = documentText;
        this.currentUri = documentUri || null;

        for (const error of parserErrors) {
            this.diagnostics.push({
                range: rangeToVscodeRange(error.range),
                message: error.message,
                severity: vscode.DiagnosticSeverity.Error,
                source: "comet",
            });
        }

        this.globalScope = this.scopeAnalyzer.analyze(program);
        this.currentScope = this.globalScope;

        this.visitProgram(program);

        return this.diagnostics.map(d => {
            const diag = new vscode.Diagnostic(d.range, d.message, d.severity);
            diag.source = d.source;
            return diag;
        });
    }

    private visitProgram(node: AST.Program): void {
        for (const stmt of node.body) {
            this.visitStatement(stmt);
        }
    }

    private visitStatement(node: AST.Statement): void {
        switch (node.type) {
            case "VarDeclaration":
                this.visitVarDeclaration(node);
                break;
            case "FuncDeclaration":
                this.visitFuncDeclaration(node);
                break;
            case "IfStatement":
                this.visitIfStatement(node);
                break;
            case "WhileStatement":
                this.visitWhileStatement(node);
                break;
            case "ReturnStatement":
                this.visitReturnStatement(node);
                break;
            case "BreakStatement":
                this.visitBreakStatement(node);
                break;
            case "ImportStatement":
                this.visitImportStatement(node);
                break;
            case "ExecuteStatement":
                this.visitExecuteStatement(node);
                break;
            case "CommandStatement":
                this.visitCommandStatement(node);
                break;
            case "MacroCommandStatement":
                this.visitMacroCommandStatement(node);
                break;
            case "ExpressionStatement":
                this.visitExpression(node.expression);
                break;
            case "BlockStatement":
                this.visitBlockStatement(node);
                break;
            default:
                break;
        }
    }

    private visitVarDeclaration(node: AST.VarDeclaration): void {
        if (this.currentScope) {
            const existing = this.currentScope.resolveLocal(
                node.name.name,
                node.name.range.start,
                "variable"
            );
            if (existing) {
                this.addDiagnostic(
                    node.name.range,
                    vscode.l10n.t(
                        "Identifier '{0}' is already defined",
                        node.name.name
                    ),
                    vscode.DiagnosticSeverity.Error
                );
            }
        }
        if (node.init) {
            this.visitExpression(node.init);
        }
    }

    private visitFuncDeclaration(node: AST.FuncDeclaration): void {
        if (this.currentScope) {
            const existing = this.currentScope.resolveLocal(
                node.name.name,
                node.name.range.start,
                "function"
            );
            if (existing) {
                this.addDiagnostic(
                    node.name.range,
                    vscode.l10n.t(
                        "Identifier '{0}' is already defined",
                        node.name.name
                    ),
                    vscode.DiagnosticSeverity.Error
                );
            }
        }
        if (node.name.name.length > 0 && /^[A-Z]/.test(node.name.name)) {
            this.addDiagnostic(
                node.name.range,
                vscode.l10n.t("Function names starting with uppercase letters may not be recognized by Minecraft"),
                vscode.DiagnosticSeverity.Warning
            );
        }

        this.inFunction++;

        const funcScope = this.findScopeForRange(node.body.range);
        if (funcScope) {
            const previousScope = this.currentScope;
            this.currentScope = funcScope;

            for (const stmt of node.body.body) {
                this.visitStatement(stmt);
            }

            this.currentScope = previousScope;
        }

        this.inFunction--;
    }

    private visitIfStatement(node: AST.IfStatement): void {
        this.visitExpression(node.condition);
        this.visitStatement(node.consequent);

        if (node.elseIfClauses.length > 0) {
            for (const elseIf of node.elseIfClauses) {
                this.visitExpression(elseIf.condition);
                this.visitStatement(elseIf.consequent);
            }
        }

        if (node.alternate) {
            this.visitStatement(node.alternate);
        }
    }

    private visitWhileStatement(node: AST.WhileStatement): void {
        this.visitExpression(node.condition);
        this.inLoop++;
        this.visitStatement(node.body);
        this.inLoop--;
    }

    private visitReturnStatement(node: AST.ReturnStatement): void {
        if (this.inFunction === 0) {
            this.addDiagnostic(
                node.range,
                vscode.l10n.t("return statement outside of function"),
                vscode.DiagnosticSeverity.Error
            );
        }

        if (node.argument) {
            this.visitExpression(node.argument);
        }
    }

    private visitBreakStatement(node: AST.BreakStatement): void {
        if (this.inLoop === 0) {
            this.addDiagnostic(
                node.range,
                vscode.l10n.t("break statement outside of loop"),
                vscode.DiagnosticSeverity.Error
            );
        }
    }

    private visitImportStatement(node: AST.ImportStatement): void {
        if (!this.currentUri || !node.source.name) return;

        const dir = path.dirname(this.currentUri.fsPath);
        const importPath = path.join(dir, `${node.source.name}.planet`);

        if (!fs.existsSync(importPath)) {
            this.addDiagnostic(
                node.source.range,
                vscode.l10n.t("Module '{0}' not found", node.source.name),
                vscode.DiagnosticSeverity.Warning
            );
        }

        if (this.currentScope) {
            const existing = this.currentScope.resolveLocal(
                node.source.name,
                node.source.range.start,
                "import"
            );
            if (existing) {
                this.addDiagnostic(
                    node.source.range,
                    vscode.l10n.t(
                        "Identifier '{0}' is already defined",
                        node.source.name
                    ),
                    vscode.DiagnosticSeverity.Error
                );
            }
        }
    }

    private visitExecuteStatement(node: AST.ExecuteStatement): void {
        const spyglass = getSpyglassManager();
        if (spyglass.isInitialized()) {
            const baseCommand = "execute " + node.subcommands;

            const errors = spyglass.validateCommand(baseCommand, {
                ignoreIncomplete: true,
            });

            for (const error of errors) {
                const adjustedStart = error.start > 8 ? error.start - 8 : 0;
                const startLine = node.subcommandRange.start.line;
                const startCol =
                    node.subcommandRange.start.character + adjustedStart;

                this.diagnostics.push({
                    range: new vscode.Range(
                        startLine,
                        startCol,
                        startLine,
                        startCol + error.length
                    ),
                    message: error.message,
                    severity:
                        error.severity === "error"
                            ? vscode.DiagnosticSeverity.Error
                            : error.severity === "warning"
                              ? vscode.DiagnosticSeverity.Warning
                              : vscode.DiagnosticSeverity.Information,
                    source: "minecraft",
                });
            }
        }

        const execScope = this.findScopeForRange(node.body.range);
        if (execScope) {
            const previousScope = this.currentScope;
            this.currentScope = execScope;

            for (const stmt of node.body.body) {
                this.visitStatement(stmt);
            }

            this.currentScope = previousScope;
        }
    }

    private checkSemicolonInCommand(text: string, baseRange: Range, offset: number): void {
        // NBT `[I;1,2,3,4]` / `[L;…]` / `[B;…]` 처럼 컴파운드/리스트 안쪽의 `;` 는 정상 문법.
        // 문자열·중괄호·대괄호 깊이 모두 추적해서 top-level 의 `;` 만 경고.
        let inString = false;
        let quote = "";
        let depth = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inString) {
                if (ch === "\\") { i++; continue; }
                if (ch === quote) { inString = false; quote = ""; }
                continue;
            }
            if (ch === '"' || ch === "'") { inString = true; quote = ch; continue; }
            if (ch === "{" || ch === "[") { depth++; continue; }
            if (ch === "}" || ch === "]") { if (depth > 0) depth--; continue; }
            if (ch === ";" && depth === 0) {
                const col = baseRange.start.character + offset + i;
                this.addDiagnostic(
                    {
                        start: { line: baseRange.start.line, character: col },
                        end: { line: baseRange.start.line, character: col + 1 },
                    },
                    vscode.l10n.t("';' inside a command is not a statement terminator; use a newline to separate commands"),
                    vscode.DiagnosticSeverity.Warning
                );
            }
        }
    }

    /**
     * cleaned 문자열 위치 → 원본(token.value) 문자열 위치 매핑 테이블.
     * cleaned 는 `\$` → `$` 로 1글자 줄어든 상태. map[i] 가 원본 token.value 의 인덱스.
     */
    private buildEscapeMap(original: string): number[] {
        const map: number[] = [];
        for (let i = 0; i < original.length; i++) {
            if (
                original[i] === "\\" &&
                i + 1 < original.length &&
                original[i + 1] === "$"
            ) {
                map.push(i + 1); // cleaned 의 $ 는 원본의 $ 위치
                i++; // 다음 $ 는 이미 처리
                continue;
            }
            map.push(i);
        }
        return map;
    }

    /**
     * 토큰값(이스케이프·라인 연속 정리된 문자열) 인덱스를 문서상 (line, col) 로 변환.
     * commandRange 와 원본 source 를 기준으로 `\\\n` 라인 연속 등을 건너뛰며 진행.
     * leadingOffset: `/` 또는 `/$` 같이 token.value 에 포함 안 된 prefix 길이.
     */
    private mapTokenOffsetToPosition(
        node: AST.CommandStatement | AST.MacroCommandStatement,
        tokenOffset: number,
        leadingOffset: number,
        document: string
    ): { line: number; character: number } {
        const sourceLines = document.split("\n");
        let line = node.commandRange.start.line;
        let col = node.commandRange.start.character + leadingOffset;
        let remaining = tokenOffset;

        while (remaining > 0 && line <= node.commandRange.end.line) {
            const lineText = sourceLines[line] ?? "";
            // `\` + 줄끝(\n) 패턴이면 다음 줄로 이동 (토큰에는 포함 안 됨).
            if (col < lineText.length && lineText[col] === "\\" && col + 1 === lineText.length) {
                line++;
                col = 0;
                continue;
            }
            // EOL 도달했는데 \-continuation 아니면 멈춤 (방어).
            if (col >= lineText.length) {
                if (line < node.commandRange.end.line) {
                    line++;
                    col = 0;
                    continue;
                }
                break;
            }
            col++;
            remaining--;
        }
        // 라인 끝에 닿았을 때 `\` 연속이면 추가로 다음 줄로.
        const lineTextNow = sourceLines[line] ?? "";
        if (
            col < lineTextNow.length &&
            lineTextNow[col] === "\\" &&
            col + 1 === lineTextNow.length &&
            line < node.commandRange.end.line
        ) {
            line++;
            col = 0;
        }
        return { line, character: col };
    }

    private documentText: string = "";
    setDocumentText(text: string) {
        this.documentText = text;
    }

    private visitCommandStatement(node: AST.CommandStatement): void {
        this.checkSemicolonInCommand(node.command, node.commandRange, 1);

        const spyglass = getSpyglassManager();
        if (spyglass.isInitialized()) {
            // comet 이스케이프: `\$` → `$` (literal `$`). spyglass 가 `\` 를 erroring 하지 않도록.
            // 다른 `\X` 는 NBT/문자열 안에서 의미가 있을 수 있으므로 그대로 둠.
            const cleaned = node.command.replace(/\\\$/g, "$");
            const map = this.buildEscapeMap(node.command);
            const errors = spyglass.validateCommand(cleaned);

            for (const error of errors) {
                // cleaned 좌표 → token.value 좌표
                const tokenStart =
                    error.start < map.length
                        ? map[error.start]
                        : node.command.length;
                const endIdx = error.start + error.length - 1;
                const tokenEndInclusive =
                    endIdx < map.length
                        ? map[endIdx]
                        : node.command.length - 1;

                // token.value 좌표 → 문서 (line, col)
                const startPos = this.mapTokenOffsetToPosition(
                    node,
                    tokenStart,
                    1,
                    this.documentText
                );
                const endPos = this.mapTokenOffsetToPosition(
                    node,
                    tokenEndInclusive + 1,
                    1,
                    this.documentText
                );

                this.diagnostics.push({
                    range: new vscode.Range(
                        startPos.line,
                        startPos.character,
                        endPos.line,
                        endPos.character
                    ),
                    message: error.message,
                    severity:
                        error.severity === "error"
                            ? vscode.DiagnosticSeverity.Error
                            : error.severity === "warning"
                              ? vscode.DiagnosticSeverity.Warning
                              : vscode.DiagnosticSeverity.Information,
                    source: "minecraft",
                });
            }
        }
    }

    private visitMacroCommandStatement(
        node: AST.MacroCommandStatement
    ): void {
        this.checkSemicolonInCommand(node.command, node.commandRange, 2);
    }

    private visitBlockStatement(node: AST.BlockStatement): void {
        const blockScope = this.findScopeForRange(node.range);
        if (blockScope) {
            const previousScope = this.currentScope;
            this.currentScope = blockScope;

            for (const stmt of node.body) {
                this.visitStatement(stmt);
            }

            this.currentScope = previousScope;
        }
    }

    private visitExpression(node: AST.Expression): void {
        switch (node.type) {
            case "Identifier":
                this.visitIdentifier(node);
                break;
            case "BinaryExpression":
                this.visitExpression(node.left);
                this.visitExpression(node.right);
                break;
            case "UnaryExpression":
                this.visitExpression(node.argument);
                break;
            case "AssignmentExpression":
                this.visitExpression(node.value);
                if (node.target.type === "Identifier") {
                    this.visitIdentifier(node.target);
                } else {
                    this.visitExpression(node.target);
                }
                break;
            case "CallExpression":
                this.visitCallExpression(node);
                break;
            case "MemberExpression":
                this.visitExpression(node.object);
                if (node.computed) {
                    this.visitExpression(node.property);
                }
                break;
            case "ArrayLiteral":
                for (const elem of node.elements) {
                    this.visitExpression(elem);
                }
                break;
            case "ParenExpression":
                this.visitExpression(node.expression);
                break;
            default:
                break;
        }
    }

    private visitIdentifier(node: AST.Identifier): void {
        if (node.name === "__namespace__" || node.name === "__main__") {
            return;
        }

        if (this.currentScope) {
            const symbol = this.currentScope.resolve(node.name, node.range.start);
            if (!symbol) {
                this.addDiagnostic(
                    node.range,
                    vscode.l10n.t("Undefined identifier: {0}", node.name),
                    vscode.DiagnosticSeverity.Warning
                );
            }
        }
    }

    private visitCallExpression(node: AST.CallExpression): void {
        if (node.callee.type === "Identifier") {
            if (this.currentScope) {
                const symbol = this.currentScope.resolve(
                    node.callee.name,
                    node.callee.range.start
                );
                if (!symbol) {
                    this.addDiagnostic(
                        node.callee.range,
                        vscode.l10n.t(
                            "Undefined function: {0}",
                            node.callee.name
                        ),
                        vscode.DiagnosticSeverity.Warning
                    );
                } else if (symbol.kind === "builtin" && symbol.params) {
                    const minParams = symbol.params.filter(
                        p => !p.name.startsWith("...")
                    ).length;
                    const hasVariadic = symbol.params.some(p =>
                        p.name.startsWith("...")
                    );

                    if (!hasVariadic && node.arguments.length !== minParams) {
                        this.addDiagnostic(
                            node.range,
                            vscode.l10n.t(
                                "Expected {0} arguments, got {1}",
                                minParams,
                                node.arguments.length
                            ),
                            vscode.DiagnosticSeverity.Warning
                        );
                    } else if (node.arguments.length < minParams) {
                        this.addDiagnostic(
                            node.range,
                            vscode.l10n.t(
                                "Expected at least {0} arguments, got {1}",
                                minParams,
                                node.arguments.length
                            ),
                            vscode.DiagnosticSeverity.Warning
                        );
                    }
                }
            }
        }

        for (const arg of node.arguments) {
            this.visitExpression(arg);
        }
    }

    private findScopeForRange(range: Range): Scope | null {
        if (!this.globalScope) return null;

        const rangeContains = (outer: Range, inner: Range): boolean => {
            const startOk =
                inner.start.line > outer.start.line ||
                (inner.start.line === outer.start.line &&
                    inner.start.character >= outer.start.character);
            const endOk =
                inner.end.line < outer.end.line ||
                (inner.end.line === outer.end.line &&
                    inner.end.character <= outer.end.character);
            return startOk && endOk;
        };

        const findScope = (scope: Scope): Scope | null => {
            if (rangeContains(scope.range, range)) {
                for (const child of scope.children) {
                    const found = findScope(child);
                    if (found) return found;
                }
                return scope;
            }
            return null;
        };

        return findScope(this.globalScope);
    }

    private addDiagnostic(
        range: Range,
        message: string,
        severity: vscode.DiagnosticSeverity
    ): void {
        this.diagnostics.push({
            range: rangeToVscodeRange(range),
            message,
            severity,
            source: "comet",
        });
    }
}
