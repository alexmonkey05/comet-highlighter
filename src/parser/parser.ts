import * as vscode from "vscode";
import { Token, TokenType } from "../lexer/token";
import { createRange, Range } from "../utils/position";
import * as AST from "./ast";

export interface ParseError {
    message: string;
    range: Range;
}

export class Parser {
    private tokens: Token[];
    private current = 0;
    private errors: ParseError[] = [];
    public comments: Token[] = [];
    private source: string;
    private lineOffsets: number[];

    constructor(tokens: Token[], source: string = "") {

        this.comments = tokens.filter(t => t.type === TokenType.Comment);
        this.tokens = tokens.filter(t => t.type !== TokenType.Comment);
        this.source = source;
        this.lineOffsets = this.computeLineOffsets(source);
    }

    private computeLineOffsets(s: string): number[] {
        const offsets = [0];
        for (let i = 0; i < s.length; i++) {
            if (s[i] === "\n") offsets.push(i + 1);
        }
        return offsets;
    }

    private getSourceText(range: Range): string {
        if (!this.source) return "";
        const startOff = (this.lineOffsets[range.start.line] ?? 0) + range.start.character;
        const endOff = (this.lineOffsets[range.end.line] ?? 0) + range.end.character;
        return this.source.substring(startOff, endOff);
    }

    parse(): AST.Program {
        const startRange = this.tokens[0]?.range || createRange(0, 0, 0, 0);
        const statements: AST.Statement[] = [];

        while (!this.isAtEnd()) {
            
            if (
                this.check(TokenType.Newline) ||
                this.check(TokenType.Semicolon)
            ) {
                this.advance();
                continue;
            }

            try {
                const stmt = this.parseStatement();
                if (stmt) {
                    statements.push(stmt);
                }
            } catch (e) {
                
                this.synchronize();
            }
        }

        // 빈 입력에서는 previous() 가 undefined — startRange 로 폴백.
        const endRange = this.previous()?.range ?? startRange;
        return {
            type: "Program",
            body: statements,
            range: createRange(
                startRange.start.line,
                startRange.start.character,
                endRange.end.line,
                endRange.end.character
            ),
        };
    }

    getErrors(): ParseError[] {
        return this.errors;
    }

    
    
    

    private parseStatement(): AST.Statement | null {
        
        if (this.match(TokenType.Var)) {
            return this.parseVarDeclaration();
        }

        
        if (this.match(TokenType.Def)) {
            return this.parseFuncDeclaration();
        }

        
        if (this.match(TokenType.If)) {
            return this.parseIfStatement();
        }

        
        if (this.match(TokenType.While)) {
            return this.parseWhileStatement();
        }

        
        if (this.match(TokenType.Return)) {
            return this.parseReturnStatement();
        }

        
        if (this.match(TokenType.Break)) {
            return this.parseBreakStatement();
        }

        
        if (this.match(TokenType.Import)) {
            return this.parseImportStatement();
        }

        
        if (this.match(TokenType.Execute)) {
            return this.parseExecuteStatement();
        }

        
        if (this.check(TokenType.CommandLine)) {
            return this.parseCommandStatement();
        }

        
        if (this.check(TokenType.MacroCommandLine)) {
            return this.parseMacroCommandStatement();
        }

        
        if (this.check(TokenType.LBrace)) {
            return this.parseBlockStatement();
        }

        
        return this.parseExpressionStatement();
    }

    private parseVarDeclaration(): AST.VarDeclaration {
        const start = this.previous();

        if (!this.check(TokenType.Identifier)) {
            this.error(vscode.l10n.t("Expected variable name"));
            return {
                type: "VarDeclaration",
                name: {
                    type: "Identifier",
                    name: "",
                    range: this.peek().range,
                },
                varType: null,
                init: null,
                range: start.range,
            };
        }

        const name = this.parseIdentifier();
        let varType: string | null = null;

        if (this.match(TokenType.Colon)) {
            const typeToken = this.consume(
                TokenType.Identifier,
                vscode.l10n.t("Expected type name")
            );
            varType = typeToken.value;
        }

        let init: AST.Expression | null = null;

        if (this.match(TokenType.Assign)) {
            init = this.parseExpression();
        }

        this.consumeStatementTerminator();

        return {
            type: "VarDeclaration",
            name,
            varType,
            init,
            range: this.makeRange(start),
        };
    }

    private parseFuncDeclaration(): AST.FuncDeclaration {
        const start = this.previous();
        const doc = this.getDocumentation(start);

        const name = this.parseIdentifier();

        this.consume(
            TokenType.LParen,
            vscode.l10n.t('Expected "(" after function name')
        );

        const params: AST.ParamDeclaration[] = [];
        this.skipNewlines();
        if (!this.check(TokenType.RParen)) {
            do {
                this.skipNewlines();
                if (!this.match(TokenType.Var)) {
                    this.error(
                        vscode.l10n.t('Expected "var" before parameter name')
                    );
                }
                const paramName = this.parseIdentifier();
                let paramType: string | null = null;
                if (this.match(TokenType.Colon)) {
                    const typeToken = this.consume(
                        TokenType.Identifier,
                        vscode.l10n.t("Expected type name")
                    );
                    paramType = typeToken.value;
                }

                params.push({
                    type: "ParamDeclaration",
                    name: paramName,
                    paramType,
                    range: paramName.range,
                });
                this.skipNewlines();
            } while (this.match(TokenType.Comma));
        }
        this.skipNewlines();

        this.consume(
            TokenType.RParen,
            vscode.l10n.t('Expected ")" after parameters')
        );

        let returnType: string | null = null;
        if (this.match(TokenType.Colon)) {
            const typeToken = this.consume(
                TokenType.Identifier,
                vscode.l10n.t("Expected return type name")
            );
            returnType = typeToken.value;
        }

        const body = this.parseBlockStatement();

        return {
            type: "FuncDeclaration",
            name,
            params,
            returnType,
            documentation: doc,
            body,
            range: this.makeRange(start),
        };
    }

    private getDocumentation(target: Token): string | null {
        const comments: string[] = [];
        let targetLine = target.range.start.line;

        // target 바로 윗줄부터 연속된 주석들을 찾음
        for (let i = this.comments.length - 1; i >= 0; i--) {
            const comment = this.comments[i];
            if (comment.range.end.line === targetLine - 1) {
                comments.unshift(comment.value.trim());
                targetLine--;
            } else if (comment.range.end.line < targetLine - 1) {
                break;
            }
        }

        return comments.length > 0 ? comments.join("\n") : null;
    }

    private parseIfStatement(): AST.IfStatement {
        const start = this.previous();

        this.consume(
            TokenType.LParen,
            vscode.l10n.t('Expected "(" after "if"')
        );
        this.skipNewlines();
        const condition = this.parseExpression();
        this.skipNewlines();
        this.consume(
            TokenType.RParen,
            vscode.l10n.t('Expected ")" after condition')
        );

        this.skipNewlines();
        const consequent = this.parseStatement()!;
        const elseIfClauses: AST.ElseIfClause[] = [];
        let alternate: AST.Statement | null = null;


        while (true) {
            const savedPos = this.current;
            while (this.check(TokenType.Newline)) {
                this.advance();
            }
            if (this.check(TokenType.Else) && this.checkNext(TokenType.If)) {
                this.advance();
                this.advance();
            } else {
                this.current = savedPos;
                break;
            }

            const elseIfStart = this.previous();
            this.consume(
                TokenType.LParen,
                vscode.l10n.t('Expected "(" after "else if"')
            );
            this.skipNewlines();
            const elseIfCondition = this.parseExpression();
            this.skipNewlines();
            this.consume(
                TokenType.RParen,
                vscode.l10n.t('Expected ")" after else if condition')
            );
            this.skipNewlines();
            const elseIfConsequent = this.parseStatement()!;

            elseIfClauses.push({
                type: "ElseIfClause",
                condition: elseIfCondition,
                consequent: elseIfConsequent,
                range: this.makeRange(elseIfStart),
            });
        }


        {
            const savedPos = this.current;
            while (this.check(TokenType.Newline)) {
                this.advance();
            }
            if (this.match(TokenType.Else)) {
                this.skipNewlines();
                alternate = this.parseStatement();
            } else {
                this.current = savedPos;
            }
        }

        return {
            type: "IfStatement",
            condition,
            consequent,
            elseIfClauses,
            alternate,
            range: this.makeRange(start),
        };
    }

    private parseWhileStatement(): AST.WhileStatement {
        const start = this.previous();

        this.consume(
            TokenType.LParen,
            vscode.l10n.t('Expected "(" after "while"')
        );
        this.skipNewlines();
        const condition = this.parseExpression();
        this.skipNewlines();
        this.consume(
            TokenType.RParen,
            vscode.l10n.t('Expected ")" after condition')
        );

        this.skipNewlines();
        const body = this.parseStatement()!;

        return {
            type: "WhileStatement",
            condition,
            body,
            range: this.makeRange(start),
        };
    }

    private parseReturnStatement(): AST.ReturnStatement {
        const start = this.previous();

        let argument: AST.Expression | null = null;

        
        if (
            !this.check(TokenType.Newline) &&
            !this.check(TokenType.Semicolon) &&
            !this.isAtEnd()
        ) {
            argument = this.parseExpression();
        }

        this.consumeStatementTerminator();

        return {
            type: "ReturnStatement",
            argument,
            range: this.makeRange(start),
        };
    }

    private parseBreakStatement(): AST.BreakStatement {
        const start = this.previous();
        this.consumeStatementTerminator();

        return {
            type: "BreakStatement",
            range: this.makeRange(start),
        };
    }

    private parseImportStatement(): AST.ImportStatement {
        const start = this.previous();

        const source = this.parseIdentifier();
        this.consumeStatementTerminator();

        return {
            type: "ImportStatement",
            source,
            range: this.makeRange(start),
        };
    }

    private parseExecuteStatement(): AST.ExecuteStatement {
        const start = this.previous();

        this.consume(
            TokenType.LParen,
            vscode.l10n.t('Expected "(" after "execute"')
        );

        // ( 직후 토큰부터 서브커맨드 시작 위치 기록
        const subcommandStartToken = this.peek();
        let subcommandEndToken = this.peek();
        let depth = 1;

        while (!this.isAtEnd() && depth > 0) {
            if (this.check(TokenType.LParen)) {
                depth++;
            } else if (this.check(TokenType.RParen)) {
                depth--;
                if (depth === 0) break;
            }
            subcommandEndToken = this.peek();
            this.advance();
        }

        const subcommandRange = createRange(
            subcommandStartToken.range.start.line,
            subcommandStartToken.range.start.character,
            subcommandEndToken.range.end.line,
            subcommandEndToken.range.end.character
        );

        // source에서 실제 텍스트 추출 — 토큰 join 대신 원본 사용
        const subcommandsText = this.getSourceText(subcommandRange).trim();

        this.consume(
            TokenType.RParen,
            vscode.l10n.t('Expected ")" after execute subcommands')
        );

        // body 는 블록 `{ ... }` 또는 단문(커맨드/매크로/execute 등) 모두 허용.
        // `execute(if ...) /say hi` 처럼 한 줄 폼을 지원.
        this.skipNewlines();
        let body: AST.BlockStatement;
        if (this.check(TokenType.LBrace)) {
            body = this.parseBlockStatement();
        } else {
            const stmtStart = this.peek();
            const single = this.parseStatement();
            const bodyRange = single
                ? single.range
                : createRange(
                      stmtStart.range.start.line,
                      stmtStart.range.start.character,
                      stmtStart.range.end.line,
                      stmtStart.range.end.character
                  );
            body = {
                type: "BlockStatement",
                body: single ? [single] : [],
                range: bodyRange,
            };
        }

        return {
            type: "ExecuteStatement",
            subcommands: subcommandsText,
            subcommandRange,
            body,
            range: this.makeRange(start),
        };
    }

    private parseCommandStatement(): AST.CommandStatement {
        const token = this.advance();

        return {
            type: "CommandStatement",
            command: token.value,
            commandRange: token.range,
            range: token.range,
        };
    }

    private parseMacroCommandStatement(): AST.MacroCommandStatement {
        const token = this.advance();


        const macroExpansions: AST.MacroExpansion[] = [];
        // lookbehind로 \$(...) 이스케이프 시퀀스 제외, /$ 프리픽스(2자) 보정
        const regex = /(?<!\\)\$\(([^)]+)\)/g;
        let match;

        while ((match = regex.exec(token.value)) !== null) {
            const varName = match[1];
            const offset = match.index;

            macroExpansions.push({
                type: "MacroExpansion",
                variable: varName,
                range: createRange(
                    token.range.start.line,
                    token.range.start.character + 2 + offset,
                    token.range.start.line,
                    token.range.start.character + 2 + offset + match[0].length
                ),
            });
        }

        return {
            type: "MacroCommandStatement",
            command: token.value,
            macroExpansions,
            commandRange: token.range,
            range: token.range,
        };
    }

    private parseExpressionStatement(): AST.ExpressionStatement {
        const expr = this.parseExpression();
        this.consumeStatementTerminator();

        return {
            type: "ExpressionStatement",
            expression: expr,
            range: expr.range,
        };
    }

    private parseBlockStatement(): AST.BlockStatement {
        const start = this.peek();

        this.consume(TokenType.LBrace, vscode.l10n.t('Expected "{"'));

        const statements: AST.Statement[] = [];

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            
            if (
                this.match(TokenType.Newline) ||
                this.match(TokenType.Semicolon)
            ) {
                continue;
            }

            const stmt = this.parseStatement();
            if (stmt) {
                statements.push(stmt);
            }
        }

        this.consume(TokenType.RBrace, vscode.l10n.t('Expected "}"'));

        return {
            type: "BlockStatement",
            body: statements,
            range: this.makeRange(start),
        };
    }

    
    
    

    private parseExpression(): AST.Expression {
        return this.parseAssignment();
    }

    private parseAssignment(): AST.Expression {
        const expr = this.parseOr();

        if (this.match(TokenType.Assign)) {
            const value = this.parseAssignment();

            if (
                expr.type === "Identifier" ||
                expr.type === "MemberExpression"
            ) {
                return {
                    type: "AssignmentExpression",
                    target: expr,
                    value,
                    range: createRange(
                        expr.range.start.line,
                        expr.range.start.character,
                        value.range.end.line,
                        value.range.end.character
                    ),
                };
            }

            this.error(vscode.l10n.t("Invalid assignment target"));
        }

        return expr;
    }

    private parseOr(): AST.Expression {
        let left = this.parseAnd();

        while (this.match(TokenType.Or)) {
            const operator = "or";
            const right = this.parseAnd();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseAnd(): AST.Expression {
        let left = this.parseEquality();

        while (this.match(TokenType.And)) {
            const operator = "and";
            const right = this.parseEquality();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseEquality(): AST.Expression {
        let left = this.parseComparison();

        while (this.match(TokenType.Eq, TokenType.NotEq)) {
            const op = this.previous().type;
            const operator = op === TokenType.Eq ? "==" : "!=";
            const right = this.parseComparison();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseComparison(): AST.Expression {
        let left = this.parseAdditive();

        while (
            this.match(
                TokenType.Lt,
                TokenType.Gt,
                TokenType.LtEq,
                TokenType.GtEq
            )
        ) {
            const op = this.previous().type;
            let operator: "<" | ">" | "<=" | ">=";
            switch (op) {
                case TokenType.Lt:
                    operator = "<";
                    break;
                case TokenType.Gt:
                    operator = ">";
                    break;
                case TokenType.LtEq:
                    operator = "<=";
                    break;
                case TokenType.GtEq:
                    operator = ">=";
                    break;
                default:
                    operator = "<";
            }
            const right = this.parseAdditive();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseAdditive(): AST.Expression {
        let left = this.parseMultiplicative();

        while (this.match(TokenType.Plus, TokenType.Minus)) {
            const op = this.previous().type;
            const operator = op === TokenType.Plus ? "+" : "-";
            const right = this.parseMultiplicative();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseMultiplicative(): AST.Expression {
        let left = this.parseUnary();

        while (this.match(TokenType.Star, TokenType.Slash, TokenType.Percent)) {
            const op = this.previous().type;
            let operator: "*" | "/" | "%";
            switch (op) {
                case TokenType.Star:
                    operator = "*";
                    break;
                case TokenType.Slash:
                    operator = "/";
                    break;
                case TokenType.Percent:
                    operator = "%";
                    break;
                default:
                    operator = "*";
            }
            const right = this.parseUnary();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseUnary(): AST.Expression {
        if (this.match(TokenType.Not, TokenType.Minus)) {
            const op = this.previous();
            const operator = op.type === TokenType.Not ? "!" : "-";
            const argument = this.parseUnary();
            return {
                type: "UnaryExpression",
                operator,
                argument,
                range: this.combineRanges(op.range, argument.range),
            };
        }

        return this.parsePostfix();
    }

    private parsePostfix(): AST.Expression {
        let expr = this.parsePrimary();

        while (true) {
            if (this.match(TokenType.LParen)) {

                const args: AST.Expression[] = [];

                this.skipNewlines();
                if (!this.check(TokenType.RParen)) {
                    do {
                        this.skipNewlines();
                        args.push(this.parseExpression());
                        this.skipNewlines();
                    } while (this.match(TokenType.Comma));
                }
                this.skipNewlines();

                const closeParen = this.consume(
                    TokenType.RParen,
                    vscode.l10n.t('Expected ")" after arguments')
                );

                if (
                    expr.type !== "Identifier" &&
                    expr.type !== "MemberExpression"
                ) {
                    this.error(vscode.l10n.t("Invalid function call target"));
                }

                expr = {
                    type: "CallExpression",
                    callee: expr as AST.Identifier | AST.MemberExpression,
                    arguments: args,
                    range: this.combineRanges(expr.range, closeParen.range),
                };
            } else if (this.match(TokenType.LBracket)) {
                
                const property = this.parseExpression();
                const closeBracket = this.consume(
                    TokenType.RBracket,
                    vscode.l10n.t('Expected "]"')
                );

                expr = {
                    type: "MemberExpression",
                    object: expr,
                    property,
                    computed: true,
                    range: this.combineRanges(expr.range, closeBracket.range),
                };
            } else if (this.match(TokenType.Dot)) {
                
                let property: AST.Expression;
                if (this.match(TokenType.StringLiteral)) {
                    const token = this.previous();
                    property = {
                        type: "StringLiteral",
                        value: token.value,
                        raw: `"${token.value}"`, // 또는 실제 따옴표 포함한 원본 문자열
                        range: this.makeRange(token),
                    };
                } else {
                    property = this.parseIdentifier();
                }

                expr = {
                    type: "MemberExpression",
                    object: expr,
                    property,
                    computed: false,
                    range: this.combineRanges(expr.range, property.range),
                };
            } else {
                break;
            }
        }

        return expr;
    }

    private parsePrimary(): AST.Expression {
        
        if (this.match(TokenType.IntLiteral)) {
            const token = this.previous();
            return {
                type: "IntLiteral",
                value: parseInt(token.value, 10),
                raw: token.value,
                range: token.range,
            };
        }

        
        if (this.match(TokenType.FloatLiteral)) {
            const token = this.previous();
            return {
                type: "FloatLiteral",
                value: parseFloat(token.value),
                raw: token.value,
                range: token.range,
            };
        }

        
        if (this.match(TokenType.DoubleLiteral)) {
            const token = this.previous();
            return {
                type: "DoubleLiteral",
                value: parseFloat(token.value),
                raw: token.value,
                range: token.range,
            };
        }

        // String literal
        if (this.match(TokenType.StringLiteral)) {
            const token = this.previous();
            return {
                type: "StringLiteral",
                value: token.value,
                raw: this.getSourceText(token.range),
                range: token.range,
            };
        }

        
        if (this.match(TokenType.BoolLiteral)) {
            const token = this.previous();
            return {
                type: "BoolLiteral",
                value: token.value === "true",
                raw: token.value,
                range: token.range,
            };
        }


        if (this.match(TokenType.LBracket)) {
            const start = this.previous();
            const elements: AST.Expression[] = [];

            this.skipNewlines();
            if (!this.check(TokenType.RBracket)) {
                do {
                    this.skipNewlines();
                    elements.push(this.parseExpression());
                    this.skipNewlines();
                } while (this.match(TokenType.Comma));
            }
            this.skipNewlines();

            const end = this.consume(TokenType.RBracket, vscode.l10n.t('Expected "]"'));

            return {
                type: "ArrayLiteral",
                elements,
                range: this.combineRanges(start.range, end.range),
            };
        }

        
        if (this.match(TokenType.LBrace)) {
            const start = this.previous();
            let depth = 1;

            while (!this.isAtEnd() && depth > 0) {
                const token = this.advance();

                if (token.type === TokenType.LBrace) {
                    depth++;
                } else if (token.type === TokenType.RBrace) {
                    depth--;
                }
            }

            const end = this.previous();
            const nbtRange = this.combineRanges(start.range, end.range);
            // source에서 실제 텍스트 추출 — 따옴표·공백 손실 방지
            const raw = this.getSourceText(nbtRange) || "{" + end.value;

            return {
                type: "NbtLiteral",
                raw,
                range: nbtRange,
            };
        }


        if (this.match(TokenType.LParen)) {
            const start = this.previous();
            this.skipNewlines();
            const expr = this.parseExpression();
            this.skipNewlines();
            const end = this.consume(TokenType.RParen, vscode.l10n.t('Expected ")"'));

            return {
                type: "ParenExpression",
                expression: expr,
                range: this.combineRanges(start.range, end.range),
            };
        }

        
        if (
            this.match(
                TokenType.Identifier,
                TokenType.DunderNamespace,
                TokenType.DunderMain
            )
        ) {
            const token = this.previous();
            return {
                type: "Identifier",
                name: token.value,
                range: token.range,
            };
        }

        
        this.error(vscode.l10n.t("Unexpected token: {0}", this.peek().value));
        const token = this.advance();
        return {
            type: "Identifier",
            name: "",
            range: token.range,
        };
    }

    private parseIdentifier(): AST.Identifier {
        if (
            this.check(TokenType.Identifier) ||
            this.check(TokenType.DunderNamespace) ||
            this.check(TokenType.DunderMain)
        ) {
            const token = this.advance();
            return {
                type: "Identifier",
                name: token.value,
                range: token.range,
            };
        }

        this.error(vscode.l10n.t("Expected identifier"));
        return {
            type: "Identifier",
            name: "",
            range: this.peek().range,
        };
    }

    
    
    

    private match(...types: TokenType[]): boolean {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }

    private check(type: TokenType): boolean {
        if (this.isAtEnd()) return false;
        return this.peek().type === type;
    }

    private checkNext(type: TokenType): boolean {
        if (this.current + 1 >= this.tokens.length) return false;
        return this.tokens[this.current + 1].type === type;
    }

    private advance(): Token {
        if (!this.isAtEnd()) this.current++;
        return this.previous();
    }

    private isAtEnd(): boolean {
        return this.peek().type === TokenType.EOF;
    }

    private peek(): Token {
        return this.tokens[this.current];
    }

    private previous(): Token {
        return this.tokens[this.current - 1];
    }

    private consume(type: TokenType, message: string): Token {
        if (this.check(type)) return this.advance();

        this.error(message);
        return this.peek();
    }

    private consumeStatementTerminator(): void {

        this.match(TokenType.Newline, TokenType.Semicolon);
    }

    private skipNewlines(): void {
        while (this.check(TokenType.Newline)) {
            this.advance();
        }
    }

    private error(message: string): void {
        const token = this.peek();
        this.errors.push({
            message,
            range: token.range,
        });
    }

    private synchronize(): void {
        this.advance();

        while (!this.isAtEnd()) {
            if (
                this.previous().type === TokenType.Newline ||
                this.previous().type === TokenType.Semicolon
            ) {
                return;
            }

            switch (this.peek().type) {
                case TokenType.Def:
                case TokenType.Var:
                case TokenType.If:
                case TokenType.While:
                case TokenType.Return:
                case TokenType.Import:
                case TokenType.Execute:
                case TokenType.CommandLine:
                case TokenType.MacroCommandLine:
                    return;
            }

            this.advance();
        }
    }

    private makeRange(start: Token): Range {
        const end = this.previous();
        return createRange(
            start.range.start.line,
            start.range.start.character,
            end.range.end.line,
            end.range.end.character
        );
    }

    private combineRanges(start: Range, end: Range): Range {
        return createRange(
            start.start.line,
            start.start.character,
            end.end.line,
            end.end.character
        );
    }
}
