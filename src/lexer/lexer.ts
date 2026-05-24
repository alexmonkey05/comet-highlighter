import { Token, TokenType, KEYWORDS, createToken } from "./token";
import { Range, createRange, createPosition } from "../utils/position";

export class Lexer {
    private source: string;
    private tokens: Token[] = [];
    private current = 0;
    private line = 0;
    private column = 0;
    private lineStart = 0;

    constructor(source: string) {
        this.source = source;
    }

    tokenize(): Token[] {
        this.tokens = [];
        this.current = 0;
        this.line = 0;
        this.column = 0;
        this.lineStart = 0;

        while (!this.isAtEnd()) {
            this.scanToken();
        }

        this.addToken(TokenType.EOF, "", this.getCurrentRange());
        return this.tokens;
    }

    private scanToken(): void {
        const startLine = this.line;
        const startColumn = this.column;

        
        if (this.isWhitespace(this.peek()) && this.peek() !== "\n") {
            this.advance();
            return;
        }

        
        if (this.peek() === "\n") {
            this.addToken(
                TokenType.Newline,
                "\n",
                this.makeRange(startLine, startColumn)
            );
            this.advance();
            this.line++;
            this.column = 0;
            this.lineStart = this.current;
            return;
        }


        const isLineStart = this.column === 0 || this.isLineStart();

        // `/` 가 커맨드라인을 시작하는 조건:
        //   (a) 라인 시작 (들여쓰기 후), 또는
        //   (b) 직전 토큰이 `)` / `}` / `{` / `;` 이고 `/` 바로 다음 글자가 [a-z_] 일 때
        //       — 단문 폼 `execute(...) /say hi`, 블록 시작 `{ /say hi }`, 등.
        //       나눗셈 연산자 `a / b` 와 충돌 안 함 (직전이 식별자/숫자라 (b) 불성립).
        if (this.peek() === "/") {
            const nextCh = this.peekNext();
            const isCommentStart = nextCh === "#";
            if (isCommentStart && isLineStart) {
                this.scanComment();
                return;
            }
            if (isLineStart) {
                this.scanCommandLine();
                return;
            }
            const isLowerIdentChar =
                (nextCh >= "a" && nextCh <= "z") || nextCh === "_";
            // 직전 토큰이 `)` 일 때만 단문 폼으로 인정. `{ /cmd }` 같이 같은 줄에서 시작·끝나는
            // 케이스는 lexer 가 `}` 를 가져가버리는 부작용이 있으므로 의도적으로 제외 (블록 안 커맨드는
            // 새 줄에 두는 기존 규칙 유지).
            // 추가: `f()/foo` 같은 무공백 division 과 충돌 안 하도록 `)` 와 `/` 사이에 공백 1개 이상 요구.
            if (isLowerIdentChar && this.tokens.length > 0) {
                const prev = this.tokens[this.tokens.length - 1];
                const prevChar =
                    this.current > 0 ? this.source[this.current - 1] : "";
                const hasSpaceBefore = prevChar === " " || prevChar === "\t";
                if (prev.type === TokenType.RParen && hasSpaceBefore) {
                    this.scanCommandLine();
                    return;
                }
            }
        }

        
        if (this.peek() === "#") {
            this.scanComment();
            return;
        }

        // Strings
        if (this.peek() === '"' || this.peek() === "'") {
            this.scanString();
            return;
        }

        
        if (this.isDigit(this.peek())) {
            this.scanNumber();
            return;
        }

        
        if (this.isAlpha(this.peek())) {
            this.scanIdentifier();
            return;
        }

        
        const ch = this.peek();
        const next = this.peekNext();

        if (ch === "=" && next === "=") {
            this.advance();
            this.advance();
            this.addToken(
                TokenType.Eq,
                "==",
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        if (ch === "!" && next === "=") {
            this.advance();
            this.advance();
            this.addToken(
                TokenType.NotEq,
                "!=",
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        if (ch === "<" && next === "=") {
            this.advance();
            this.advance();
            this.addToken(
                TokenType.LtEq,
                "<=",
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        if (ch === ">" && next === "=") {
            this.advance();
            this.advance();
            this.addToken(
                TokenType.GtEq,
                ">=",
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        
        const char = this.advance();
        switch (char) {
            case "+":
                this.addToken(
                    TokenType.Plus,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "-":
                this.addToken(
                    TokenType.Minus,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "*":
                this.addToken(
                    TokenType.Star,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "/":
                this.addToken(
                    TokenType.Slash,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "%":
                this.addToken(
                    TokenType.Percent,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "=":
                this.addToken(
                    TokenType.Assign,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "!":
                this.addToken(
                    TokenType.Not,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "<":
                this.addToken(
                    TokenType.Lt,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ">":
                this.addToken(
                    TokenType.Gt,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "(":
                this.addToken(
                    TokenType.LParen,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ")":
                this.addToken(
                    TokenType.RParen,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "{":
                this.addToken(
                    TokenType.LBrace,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "}":
                this.addToken(
                    TokenType.RBrace,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "[":
                this.addToken(
                    TokenType.LBracket,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "]":
                this.addToken(
                    TokenType.RBracket,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ",":
                this.addToken(
                    TokenType.Comma,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ".":
                this.addToken(
                    TokenType.Dot,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ";":
                this.addToken(
                    TokenType.Semicolon,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ":":
                this.addToken(
                    TokenType.Colon,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            default:
                
                break;
        }
    }

    private scanCommandLine(): void {
        const startLine = this.line;
        const startColumn = this.column;

        this.advance();


        const isMacro = this.peek() === "$";
        if (isMacro) {
            this.advance();
        }

        // 본문 누적. 처리 규칙:
        //  - `\` + 개행  : 라인 연속 (둘 다 소비, 줄 카운터 이동, 토큰 본문에는 미포함)
        //  - 그 외 백슬래시는 그대로 보존 (NBT/문자열의 `\"`, comet 의 `\$` 이스케이프 등은
        //    이후 validator/diagnostics 단계에서 의미별로 해석).
        let value = "";
        while (!this.isAtEnd()) {
            const c = this.peek();
            if (c === "\\" && this.peekNext() === "\n") {
                this.advance(); // consume '\'
                this.advance(); // consume '\n'
                this.line++;
                this.column = 0;
                this.lineStart = this.current;
                continue;
            }
            if (c === "\n") break;
            value += this.advance();
        }

        const tokenType = isMacro
            ? TokenType.MacroCommandLine
            : TokenType.CommandLine;

        this.addToken(
            tokenType,
            value,
            this.makeRange(startLine, startColumn)
        );
    }

    private scanComment(): void {
        const startLine = this.line;
        const startColumn = this.column;

        this.advance(); 

        
        const start = this.current;
        while (!this.isAtEnd() && this.peek() !== "\n") {
            this.advance();
        }

        const commentText = this.source.substring(start, this.current);
        this.addToken(
            TokenType.Comment,
            commentText,
            this.makeRange(startLine, startColumn)
        );
    }

    private scanString(): void {
        const startLine = this.line;
        const startColumn = this.column;
        const quote = this.advance(); // Consume and get the quote that started the string

        let value = "";
        while (!this.isAtEnd() && this.peek() !== quote) {
            if (this.peek() === "\\") {
                this.advance(); 
                if (!this.isAtEnd()) {
                    const escaped = this.advance();
                    
                    switch (escaped) {
                        case "n":
                            value += "\n";
                            break;
                        case "t":
                            value += "\t";
                            break;
                        case "r":
                            value += "\r";
                            break;
                        case "\\":
                            value += "\\";
                            break;
                        case '"':
                            value += '"';
                            break;
                        case "'":
                            value += "'";
                            break;
                        default:
                            value += escaped;
                            break;
                    }
                }
            } else {
                if (this.peek() === "\n") {
                    this.line++;
                    this.column = 0;
                    this.lineStart = this.current + 1;
                }
                value += this.advance();
            }
        }

        if (!this.isAtEnd() && this.peek() === quote) {
            this.advance(); 
        }

        this.addToken(
            TokenType.StringLiteral,
            value,
            this.makeRange(startLine, startColumn)
        );
    }

    private scanNumber(): void {
        const startLine = this.line;
        const startColumn = this.column;
        const start = this.current;
        let hasDecimal = false;

        while (this.isDigit(this.peek())) {
            this.advance();
        }

        if (this.peek() === "." && this.isDigit(this.peekNext())) {
            hasDecimal = true;
            this.advance();
            while (this.isDigit(this.peek())) {
                this.advance();
            }
        }

        // NBT 스타일 접미사: f/F → float, d/D → double,
        // b/B·s/S·l/L → 정수 변종 (이 언어는 별도 타입 없으므로 IntLiteral)
        // 접미사 이후가 식별자 문자면 변수명으로 판단해 접미사로 보지 않음.
        const c = this.peek();
        const safeTail = !this.isAlphaNumeric(this.peekNext());

        if ((c === "f" || c === "F") && safeTail) {
            this.advance();
            const value = this.source.substring(start, this.current);
            this.addToken(
                TokenType.FloatLiteral,
                value,
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        if ((c === "d" || c === "D") && safeTail) {
            this.advance();
            const value = this.source.substring(start, this.current);
            this.addToken(
                TokenType.DoubleLiteral,
                value,
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        if (
            !hasDecimal &&
            (c === "b" ||
                c === "B" ||
                c === "s" ||
                c === "S" ||
                c === "l" ||
                c === "L") &&
            safeTail
        ) {
            this.advance();
            const value = this.source.substring(start, this.current);
            this.addToken(
                TokenType.IntLiteral,
                value,
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        const value = this.source.substring(start, this.current);
        this.addToken(
            hasDecimal ? TokenType.DoubleLiteral : TokenType.IntLiteral,
            value,
            this.makeRange(startLine, startColumn)
        );
    }

    private scanIdentifier(): void {
        const startLine = this.line;
        const startColumn = this.column;
        const start = this.current;

        while (this.isAlphaNumeric(this.peek())) {
            this.advance();
        }

        const value = this.source.substring(start, this.current);

        
        const keywordType = KEYWORDS.get(value);
        if (keywordType !== undefined) {
            this.addToken(
                keywordType,
                value,
                this.makeRange(startLine, startColumn)
            );
        } else {
            this.addToken(
                TokenType.Identifier,
                value,
                this.makeRange(startLine, startColumn)
            );
        }
    }

    private isLineStart(): boolean {
        
        for (let i = this.lineStart; i < this.current; i++) {
            const ch = this.source[i];
            if (ch !== " " && ch !== "\t") {
                return false;
            }
        }
        return true;
    }

    private isWhitespace(ch: string): boolean {
        return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
    }

    private isDigit(ch: string): boolean {
        return ch >= "0" && ch <= "9";
    }

    private isAlpha(ch: string): boolean {
        return (
            (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_"
        );
    }

    private isAlphaNumeric(ch: string): boolean {
        return this.isAlpha(ch) || this.isDigit(ch);
    }

    private peek(): string {
        if (this.isAtEnd()) return "\0";
        return this.source[this.current];
    }

    private peekNext(): string {
        if (this.current + 1 >= this.source.length) return "\0";
        return this.source[this.current + 1];
    }

    private advance(): string {
        const ch = this.source[this.current];
        this.current++;
        this.column++;
        return ch;
    }

    private isAtEnd(): boolean {
        return this.current >= this.source.length;
    }

    private getCurrentRange(): Range {
        return createRange(this.line, this.column, this.line, this.column);
    }

    private makeRange(startLine: number, startColumn: number): Range {
        return createRange(startLine, startColumn, this.line, this.column);
    }

    private addToken(type: TokenType, value: string, range: Range): void {
        this.tokens.push(createToken(type, value, range));
    }
}
