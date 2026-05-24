import * as vscode from "vscode";
import { DocumentManager } from "../utils/document";
import { BUILTIN_FUNCTIONS } from "../analysis/scope";
import { Token, TokenType } from "../lexer/token";
import { Lexer } from "../lexer/lexer";
import * as AST from "../parser/ast";
import { Parser } from "../parser/parser";
import { getSpyglassManager } from "../minecraft/spyglass";

export class CompletionProvider implements vscode.CompletionItemProvider {
    private documentManager: DocumentManager;

    constructor(documentManager: DocumentManager) {
        this.documentManager = documentManager;
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const parseResult = this.documentManager.parse(document);
        const line = document.lineAt(position.line);
        const lineText = line.text.substring(0, position.character);
        const textBeforeCursor = document.getText(
            new vscode.Range(0, 0, position.line, position.character)
        );

        const wordRange = document.getWordRangeAtPosition(position);

        const lexer = new Lexer(textBeforeCursor);
        const tokens = lexer.tokenize();

        const structuralTokens = tokens.filter(
            t => t.type !== TokenType.Comment
        );
        const nonNewlineTokens = structuralTokens.filter(
            t => t.type !== TokenType.Newline
        );

        const items: vscode.CompletionItem[] = [];

        const match = lineText.match(/^(\s*)\/+(.*)$/);
        if (match) {
            const commandText = match[2];
            const spyglassManager = getSpyglassManager();
            const availableTags = this.collectTags(parseResult.scope);
            const mcCompletions = spyglassManager.getCommandCompletions(
                commandText,
                commandText.length,
                availableTags
            );

            return mcCompletions.map(comp => {
                const item = new vscode.CompletionItem(
                    comp.label,
                    comp.kind ?? vscode.CompletionItemKind.Keyword
                );
                item.detail =
                    comp.detail || vscode.l10n.t("Minecraft command");
                if (comp.insertText) item.insertText = comp.insertText;
                if (comp.sortText) item.sortText = comp.sortText;
                if (wordRange) item.range = wordRange;
                return item;
            });
        }

        const lastToken = nonNewlineTokens[nonNewlineTokens.length - 1];
        const secondLastToken = nonNewlineTokens[nonNewlineTokens.length - 2];

        if (secondLastToken?.type === TokenType.Var) {
            return [];
        }

        if (secondLastToken?.type === TokenType.Def) {
            items.push(
                this.createSnippet(
                    "tick",
                    "tick(){\n\t$0\n}",
                    vscode.l10n.t("Special function: runs every tick"),
                    wordRange
                )
            );
            items.push(
                this.createSnippet(
                    "load",
                    "load(){\n\t$0\n}",
                    vscode.l10n.t("Special function: runs on datapack load"),
                    wordRange
                )
            );
            return items;
        }

        if (secondLastToken?.type === TokenType.Import) {
            const currentDir = vscode.Uri.joinPath(document.uri, "..");
            return vscode.workspace.fs.readDirectory(currentDir).then(files => {
                const planetFiles = files
                    .filter(
                        ([name, type]) =>
                            type === vscode.FileType.File &&
                            name.endsWith(".planet")
                    )
                    .map(([name]) => {
                        const moduleName = name.replace(".planet", "");
                        const item = new vscode.CompletionItem(
                            moduleName,
                            vscode.CompletionItemKind.Module
                        );
                        item.detail = name;
                        if (wordRange) item.range = wordRange;
                        return item;
                    });
                return planetFiles;
            });
        }

        if (lastToken?.type === TokenType.Dot) {
            const objectToken = nonNewlineTokens[nonNewlineTokens.length - 2];
            if (objectToken?.type === TokenType.Identifier) {
                const symbol = parseResult.scope.resolve(objectToken.value);
                if (symbol?.kind === "import") {
                    return this.getImportMemberCompletions(
                        document, objectToken.value, wordRange
                    );
                }
            }
            return [];
        }

        const executeContext = this.getExecuteContext(textBeforeCursor);
        if (executeContext) {
            const spyglassManager = getSpyglassManager();
            const command = "execute " + executeContext.content;
            const relativePos = 8 + executeContext.content.length;

            const availableTags = this.collectTags(parseResult.scope);
            const mcCompletions = spyglassManager.getCommandCompletions(
                command,
                relativePos,
                availableTags
            );
            return mcCompletions.map(comp => {
                const item = new vscode.CompletionItem(
                    comp.label,
                    vscode.CompletionItemKind.Keyword
                );
                item.detail =
                    comp.detail ||
                    vscode.l10n.t("Execute subcommand");
                if (wordRange) item.range = wordRange;
                return item;
            });
        }

        items.push(
            this.createKeyword(
                "var",
                "var ${1:name} = $0",
                vscode.l10n.t("Variable declaration"),
                wordRange
            )
        );
        items.push(
            this.createKeyword(
                "def",
                "def ${1:name}(${2}){\n\t$0\n}",
                vscode.l10n.t("Function declaration"),
                wordRange
            )
        );
        items.push(
            this.createKeyword(
                "if",
                "if(${1:condition}){\n\t$0\n}",
                vscode.l10n.t("If statement"),
                wordRange
            )
        );
        items.push(
            this.createKeyword(
                "else",
                "else {\n\t$0\n}",
                vscode.l10n.t("Else clause"),
                wordRange
            )
        );
        items.push(
            this.createKeyword(
                "while",
                "while(${1:condition}){\n\t$0\n}",
                vscode.l10n.t("While loop"),
                wordRange
            )
        );
        items.push(
            this.createKeyword(
                "return",
                "return $0",
                vscode.l10n.t("Return statement"),
                wordRange
            )
        );
        items.push(
            this.createKeyword(
                "break",
                "break",
                vscode.l10n.t("Break statement"),
                wordRange
            )
        );
        items.push(
            this.createKeyword(
                "import",
                "import ${1:module}",
                vscode.l10n.t("Import module"),
                wordRange
            )
        );
        items.push(
            this.createKeyword(
                "execute",
                "execute(${1:subcommands}){\n\t$0\n}",
                vscode.l10n.t("Execute statement"),
                wordRange
            )
        );

        const cmdItem = new vscode.CompletionItem(
            "/",
            vscode.CompletionItemKind.Keyword
        );
        cmdItem.detail = vscode.l10n.t("Minecraft command");
        cmdItem.insertText = "/$0";
        if (wordRange) cmdItem.range = wordRange;
        items.push(cmdItem);

        for (const builtin of BUILTIN_FUNCTIONS) {
            const item = new vscode.CompletionItem(
                builtin.name,
                vscode.CompletionItemKind.Function
            );
            item.detail = builtin.returnType
                ? `${builtin.name}(${this.formatParams(builtin.params || [])}) → ${builtin.returnType}`
                : builtin.name;

            const paramSnippets = (builtin.params || [])
                .filter(p => !p.name.startsWith("..."))
                .map((p, i) => `\${${i + 1}:${p.name}}`)
                .join(", ");
            item.insertText = new vscode.SnippetString(
                `${builtin.name}(${paramSnippets})$0`
            );
            if (wordRange) item.range = wordRange;

            items.push(item);
        }

        const currentScope = this.findScopeAtPosition(
            parseResult.scope,
            position
        );
        const scopeItems = this.getScopeCompletions(
            currentScope,
            position,
            wordRange
        );
        items.push(...scopeItems);

        items.push(
            this.createSpecial(
                "__namespace__",
                vscode.l10n.t("Current namespace"),
                wordRange
            )
        );
        items.push(
            this.createSpecial(
                "__main__",
                vscode.l10n.t("Main module check"),
                wordRange
            )
        );

        items.push(
            this.createConstant(
                "true",
                vscode.l10n.t("Boolean true"),
                wordRange
            )
        );
        items.push(
            this.createConstant(
                "false",
                vscode.l10n.t("Boolean false"),
                wordRange
            )
        );

        return items;
    }

    private getExecuteContext(text: string): { content: string } | null {
        let parenDepth = 0;
        let braceDepth = 0;

        for (let i = text.length - 1; i >= 0; i--) {
            const char = text[i];

            if (char === ")") parenDepth++;
            else if (char === "(") {
                if (parenDepth > 0) parenDepth--;
                else {
                    const preceding = text.substring(0, i).trim();
                    if (preceding.endsWith("execute")) {
                        if (braceDepth !== 0) return null;
                        return { content: text.substring(i + 1) };
                    }
                }
            } else if (char === "}") braceDepth++;
            else if (char === "{") {
                braceDepth--;
                if (braceDepth < 0) return null;
            }
        }
        return null;
    }

    private findScopeAtPosition(scope: any, position: vscode.Position): any {
        if (!scope) return null;

        const isPositionInRange = (range: any) => {
            if (!range) return false;
            const start = range.start;
            const end = range.end;

            if (position.line < start.line || position.line > end.line) {
                return false;
            }

            if (
                position.line === start.line &&
                position.character < start.character
            ) {
                return false;
            }

            if (
                position.line === end.line &&
                position.character > end.character
            ) {
                return false;
            }

            return true;
        };

        for (const child of scope.children || []) {
            if (isPositionInRange(child.range)) {
                const deeperScope = this.findScopeAtPosition(child, position);
                return deeperScope || child;
            }
        }

        return scope;
    }

    private getScopeCompletions(
        scope: any,
        position: vscode.Position,
        range?: vscode.Range
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        const collectSymbols = (currentScope: any) => {
            if (!currentScope) return;

            for (const [name, symbol] of currentScope.symbols) {
                if (symbol.kind === "builtin") continue;

                let kind: vscode.CompletionItemKind;
                let detail = "";

                switch (symbol.kind) {
                    case "function":
                        kind = vscode.CompletionItemKind.Function;
                        detail = vscode.l10n.t(
                            "function {0}",
                            `${name}(${this.formatParams(symbol.params || [])})`
                        );
                        break;
                    case "variable":
                        kind = vscode.CompletionItemKind.Variable;
                        detail = vscode.l10n.t("variable {0}", name);
                        break;
                    case "parameter":
                        kind = vscode.CompletionItemKind.Variable;
                        detail = vscode.l10n.t("parameter {0}", name);
                        break;
                    case "import":
                        kind = vscode.CompletionItemKind.Module;
                        detail = vscode.l10n.t("module {0}", name);
                        break;
                    case "score":
                        kind = vscode.CompletionItemKind.Value;
                        detail = vscode.l10n.t(
                            "score {0} {1}",
                            symbol.scope ?? "",
                            name
                        );
                        break;
                    case "storage":
                        kind = vscode.CompletionItemKind.Struct;
                        detail = vscode.l10n.t("storage {0}", name);
                        break;
                    case "tag":
                        kind = vscode.CompletionItemKind.Value;
                        detail = vscode.l10n.t("tag {0}", name);
                        break;
                    default:
                        kind = vscode.CompletionItemKind.Variable;
                }

                const item = new vscode.CompletionItem(name, kind);
                item.detail = detail;

                if (symbol.kind === "function") {
                    const paramSnippets = (symbol.params || [])
                        .map((p: any, i: number) => `\${${i + 1}:${p.name}}`)
                        .join(", ");
                    item.insertText = new vscode.SnippetString(
                        `${name}(${paramSnippets})$0`
                    );
                }

                if (range) item.range = range;

                items.push(item);
            }

            if (currentScope.parent) {
                collectSymbols(currentScope.parent);
            }
        };

        collectSymbols(scope);

        return items;
    }

    private collectTags(scope: any): string[] {
        const tags: string[] = [];
        const checkedScopes = new Set<any>();

        const visit = (currentScope: any) => {
            if (!currentScope || checkedScopes.has(currentScope)) return;
            checkedScopes.add(currentScope);

            if (currentScope.symbols) {
                for (const [name, symbol] of currentScope.symbols) {
                    if (symbol.kind === "tag") {
                        tags.push(name);
                    }
                }
            }

            if (currentScope.parent) {
                visit(currentScope.parent);
            }
        };

        visit(scope);
        return Array.from(new Set(tags));
    }

    private formatParams(params: any[]): string {
        return params
            .map(p => (p.type ? `${p.name}: ${p.type}` : p.name))
            .join(", ");
    }

    private createKeyword(
        label: string,
        snippet: string,
        description: string,
        range?: vscode.Range
    ): vscode.CompletionItem {
        const item = new vscode.CompletionItem(
            label,
            vscode.CompletionItemKind.Keyword
        );
        item.insertText = new vscode.SnippetString(snippet);
        item.detail = description;
        if (range) item.range = range;
        return item;
    }

    private createSnippet(
        label: string,
        snippet: string,
        description: string,
        range?: vscode.Range
    ): vscode.CompletionItem {
        const item = new vscode.CompletionItem(
            label,
            vscode.CompletionItemKind.Snippet
        );
        item.insertText = new vscode.SnippetString(snippet);
        item.detail = description;
        if (range) item.range = range;
        return item;
    }

    private createSpecial(
        label: string,
        description: string,
        range?: vscode.Range
    ): vscode.CompletionItem {
        const item = new vscode.CompletionItem(
            label,
            vscode.CompletionItemKind.Constant
        );
        item.detail = description;
        if (range) item.range = range;
        return item;
    }

    private createConstant(
        label: string,
        description: string,
        range?: vscode.Range
    ): vscode.CompletionItem {
        const item = new vscode.CompletionItem(
            label,
            vscode.CompletionItemKind.Constant
        );
        item.detail = description;
        if (range) item.range = range;
        return item;
    }

    private async getImportMemberCompletions(
        document: vscode.TextDocument,
        moduleName: string,
        wordRange?: vscode.Range
    ): Promise<vscode.CompletionItem[]> {
        try {
            const moduleUri = vscode.Uri.joinPath(
                document.uri, "..", `${moduleName}.planet`
            );
            const data = await vscode.workspace.fs.readFile(moduleUri);
            const text = Array.from(data as Uint8Array, (b: number) => String.fromCharCode(b)).join("");

            const lexer = new Lexer(text);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, text);
            const program = parser.parse();

            const items: vscode.CompletionItem[] = [];
            for (const stmt of program.body) {
                if (stmt.type === "FuncDeclaration") {
                    const funcStmt = stmt as AST.FuncDeclaration;
                    const item = new vscode.CompletionItem(
                        funcStmt.name.name,
                        vscode.CompletionItemKind.Function
                    );
                    const params = funcStmt.params.map(p => p.name.name);
                    const paramSnippets = params
                        .map((p, i) => `\${${i + 1}:${p}}`)
                        .join(", ");
                    item.insertText = new vscode.SnippetString(
                        `${funcStmt.name.name}(${paramSnippets})$0`
                    );
                    item.detail = `${moduleName}.${funcStmt.name.name}(${params.join(", ")})`;
                    if (wordRange) item.range = wordRange;
                    items.push(item);
                }
            }
            return items;
        } catch {
            return [];
        }
    }
}
