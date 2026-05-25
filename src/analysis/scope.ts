import { Range } from "../utils/position";
import * as AST from "../parser/ast";
import { TypeInference } from "./type_inference";

export type SymbolKind =
    | "variable"
    | "function"
    | "parameter"
    | "import"
    | "builtin"
    | "score"
    | "tag"
    | "storage";

export interface Symbol {
    name: string;
    kind: SymbolKind;
    declarationRange: Range;
    originalRange?: Range;
    params?: ParamInfo[];
    returnType?: string;
    value?: string;
    documentation?: string;
    
    scope?: string; 
}

export interface ParamInfo {
    name: string;
    type?: string;
}

export class Scope {
    parent: Scope | null = null;
    children: Scope[] = [];
    symbols: Map<string, Symbol[]> = new Map();
    range: Range;

    constructor(range: Range, parent: Scope | null = null) {
        this.range = range;
        this.parent = parent;
        if (parent) {
            parent.children.push(this);
        }
    }

    define(symbol: Symbol): void {
        let list = this.symbols.get(symbol.name);
        if (!list) {
            list = [];
            this.symbols.set(symbol.name, list);
        }
        list.push(symbol);
    }

    resolve(name: string, pos?: { line: number; character: number }, kind?: SymbolKind): Symbol | null {
        const list = this.symbols.get(name);
        if (list) {
            if (pos) {
                for (let i = list.length - 1; i >= 0; i--) {
                    const s = list[i];
                    if (kind && s.kind !== kind) {
                        // kind가 지정된 경우, 변수/파라미터는 서로 호환되도록 처리
                        if (kind === "variable" || kind === "parameter") {
                            if (s.kind !== "variable" && s.kind !== "parameter") continue;
                        } else {
                            continue;
                        }
                    }
                    if (this.isBefore(s.declarationRange.end, pos)) {
                        return s;
                    }
                }
            } else {
                if (kind) {
                    for (let i = list.length - 1; i >= 0; i--) {
                        const s = list[i];
                        if (kind === "variable" || kind === "parameter") {
                            if (s.kind === "variable" || s.kind === "parameter") return s;
                        } else if (s.kind === kind) {
                            return s;
                        }
                    }
                } else {
                    return list[list.length - 1];
                }
            }
        }
        if (this.parent) {
            return this.parent.resolve(name, pos, kind);
        }
        return null;
    }

    resolveLocal(name: string, pos?: { line: number; character: number }, kind?: SymbolKind): Symbol | null {
        const list = this.symbols.get(name);
        if (list) {
            if (pos) {
                for (let i = list.length - 1; i >= 0; i--) {
                    const s = list[i];
                    if (kind && s.kind !== kind) {
                        if (kind === "variable" || kind === "parameter") {
                            if (s.kind !== "variable" && s.kind !== "parameter") continue;
                        } else {
                            continue;
                        }
                    }
                    if (this.isBefore(s.declarationRange.end, pos)) {
                        return s;
                    }
                }
            } else {
                if (kind) {
                    for (let i = list.length - 1; i >= 0; i--) {
                        const s = list[i];
                        if (kind === "variable" || kind === "parameter") {
                            if (s.kind === "variable" || s.kind === "parameter") return s;
                        } else if (s.kind === kind) {
                            return s;
                        }
                    }
                } else {
                    return list[list.length - 1];
                }
            }
        }
        return null;
    }

    private isBefore(a: { line: number; character: number }, b: { line: number; character: number }): boolean {
        if (a.line < b.line) return true;
        if (a.line > b.line) return false;
        return a.character <= b.character;
    }

    findScope(pos: { line: number; character: number }): Scope {
        for (const child of this.children) {
            if (this.rangeContains(child.range, pos)) {
                return child.findScope(pos);
            }
        }
        return this;
    }

    private rangeContains(range: Range, pos: { line: number; character: number }): boolean {
        if (pos.line < range.start.line || pos.line > range.end.line) {
            return false;
        }
        if (pos.line === range.start.line && pos.character < range.start.character) {
            return false;
        }
        if (pos.line === range.end.line && pos.character > range.end.character) {
            return false;
        }
        return true;
    }
}


export const BUILTIN_FUNCTIONS: Symbol[] = [
    {
        name: "print",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "a1" }, { name: "...args" }],
        returnType: "void",
        documentation: "Print values to the console",
    },
    {
        name: "random",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [],
        returnType: "double",
        documentation: "Generate a random double value",
    },
    {
        name: "type",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "a" }],
        returnType: "string",
        documentation: "Get the type of a value",
    },
    {
        name: "round",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "a", type: "float|double" }],
        returnType: "int",
        documentation: "Round a float or double to the nearest integer",
    },
    {
        name: "get_score",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "player", type: "string|entity" },
            { name: "objective", type: "string" },
        ],
        returnType: "int",
        documentation: "Get a scoreboard score",
    },
    {
        name: "set_score",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "player", type: "string|entity" },
            { name: "objective", type: "string" },
            { name: "var" },
        ],
        returnType: "any",
        documentation: "Set a scoreboard score",
    },
    {
        name: "get_data",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "from", type: "string" },
            { name: "name", type: "string|entity" },
            { name: "dir", type: "string" },
        ],
        returnType: "nbt",
        documentation: "Get NBT data",
    },
    {
        name: "set_data",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "from", type: "string" },
            { name: "name", type: "string|entity" },
            { name: "dir", type: "string" },
            { name: "var" },
        ],
        returnType: "void",
        documentation: "Set NBT data",
    },
    {
        name: "append",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "arr", type: "any[]" }, { name: "element" }],
        returnType: "void",
        documentation: "Append a value to an array",
    },
    {
        name: "del",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "var" }],
        returnType: "void",
        documentation: "Delete a value",
    },
    {
        name: "len",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "var", type: "array|string" }],
        returnType: "int",
        documentation: "Get the length of an array or string",
    },
    {
        name: "is_module",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [],
        returnType: "bool",
        documentation: "Check if the current file is being imported as a module",
    },
    {
        name: "divide",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "var", type: "number" },
            { name: "var2", type: "number" },
        ],
        returnType: "float",
        documentation: "Divide two numbers and return a float",
    },
    {
        name: "multiply",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "var", type: "number" },
            { name: "var2", type: "number" },
        ],
        returnType: "float",
        documentation: "Multiply two numbers and return a float",
    },
    {
        name: "int",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "a" }],
        returnType: "int",
        documentation: "Convert a value to an integer",
    },
    {
        name: "float",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "a" }],
        returnType: "float",
        documentation: "Convert a value to a float",
    },
    {
        name: "double",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "a" }],
        returnType: "double",
        documentation: "Convert a value to a double",
    },
    {
        name: "bool",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "a" }],
        returnType: "bool",
        documentation: "Convert a value to a boolean",
    },
    {
        name: "string",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "a" }],
        returnType: "string",
        documentation: "Convert a value to a string",
    },
];

export class ScopeAnalyzer {
    private globalScope: Scope;
    private currentScope: Scope;

    constructor() {
        this.globalScope = new Scope({
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        });
        this.currentScope = this.globalScope;

        
        for (const builtin of BUILTIN_FUNCTIONS) {
            this.globalScope.define(builtin);
        }
    }

    analyze(program: AST.Program): Scope {
        this.globalScope.range = program.range;
        
        // 1차 패스: 모든 함수 정의를 먼저 등록
        for (const stmt of program.body) {
            if (stmt.type === "FuncDeclaration") {
                const params: ParamInfo[] = stmt.params.map(p => ({
                    name: p.name.name,
                    type: p.paramType || undefined,
                }));

                this.globalScope.define({
                    name: stmt.name.name,
                    kind: "function",
                    declarationRange: stmt.name.range,
                    params,
                    returnType: stmt.returnType || undefined,
                    documentation: stmt.documentation || undefined,
                });
            }
        }

        // 1.5차 패스: 등록된 함수들의 반환 타입 추론 (상호 참조 지원)
        const inference = new TypeInference();
        let changed = true;
        let iterations = 0;
        
        while (changed && iterations < 5) {
            changed = false;
            for (const stmt of program.body) {
                if (stmt.type === "FuncDeclaration" && !stmt.returnType) {
                    const symbol = this.globalScope.resolveLocal(stmt.name.name);
                    if (symbol) {
                        // 함수 내부 스코프를 임시로 생성하여 매개변수와 지역 변수 파악
                        const tempScope = new Scope(stmt.body.range, this.globalScope);
                        
                        // 임시 스코프가 globalScope.children에 추가되는 것을 방지
                        const index = this.globalScope.children.indexOf(tempScope);
                        if (index > -1) {
                            this.globalScope.children.splice(index, 1);
                        }
                        
                        for (const p of stmt.params) {
                            tempScope.define({
                                name: p.name.name,
                                kind: "parameter",
                                declarationRange: p.name.range,
                                returnType: p.paramType || undefined
                            });
                        }

                        for (const s of stmt.body.body) {
                            if (s.type === "VarDeclaration") {
                                let vType = s.varType || undefined;
                                if (!vType && s.init) {
                                    vType = inference.infer(s.init, tempScope);
                                }
                                tempScope.define({
                                    name: s.name.name,
                                    kind: "variable",
                                    declarationRange: s.name.range,
                                    returnType: vType
                                });
                            }
                        }
                        
                        const inferredType = inference.inferReturnType(stmt, tempScope);
                        const newType = (inferredType === "any" || inferredType === "void") ? undefined : inferredType;
                        
                        if (symbol.returnType !== newType && newType !== undefined) {
                            symbol.returnType = newType;
                            changed = true;
                        } else if (iterations === 4 && symbol.returnType === undefined) {
                            // 마지막 반복에서도 추론 실패 시 void 처리 (또는 any)
                            symbol.returnType = inferredType;
                        }
                    }
                }
            }
            iterations++;
        }

        // 2차 패스: 전체 본문 분석 (함수 내부 포함)
        this.visitProgram(program);
        return this.globalScope;
    }

    getGlobalScope(): Scope {
        return this.globalScope;
    }

    private visitProgram(node: AST.Program): void {
        for (const stmt of node.body) {
            // 이미 1차 패스에서 처리한 함수 선언은 본문 내부 분석만 수행
            if (stmt.type === "FuncDeclaration") {
                this.visitFuncBody(stmt);
            } else {
                this.visitStatement(stmt);
            }
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
                if (node.argument) {
                    this.visitExpression(node.argument);
                }
                break;
            case "ImportStatement":
                this.visitImportStatement(node);
                break;
            case "ExecuteStatement":
                this.visitExecuteStatement(node);
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
        let typeStr: string | undefined = node.varType || undefined;
        let valueStr: string | undefined = undefined;
        
        const inference = new TypeInference();

        // 만약 타입이 명시되지 않았고 초기화 식이 있다면 타입 추론 시도
        if (!typeStr && node.init) {
            typeStr = inference.infer(node.init, this.currentScope);
        }

        if (node.init) {
            valueStr = inference.evaluate(node.init, this.currentScope) || undefined;
        } else if (typeStr === "int") {
            valueStr = "0";
        }

        this.currentScope.define({
            name: node.name.name,
            kind: "variable",
            declarationRange: node.name.range,
            originalRange: node.name.range,
            returnType: typeStr,
            value: valueStr,
            documentation: node.documentation || undefined,
        });

        if (node.init) {
            this.visitExpression(node.init);
        }
    }

    private visitFuncBody(node: AST.FuncDeclaration): void {
        const funcScope = new Scope(node.body.range, this.currentScope);
        const previousScope = this.currentScope;
        this.currentScope = funcScope;

        for (const param of node.params) {
            funcScope.define({
                name: param.name.name,
                kind: "parameter",
                declarationRange: param.name.range,
                originalRange: param.name.range,
                returnType: param.paramType || undefined,
            });
        }

        for (const stmt of node.body.body) {
            this.visitStatement(stmt);
        }

        this.currentScope = previousScope;
    }

    private visitFuncDeclaration(node: AST.FuncDeclaration): void {
        // 이미 1차 패스(analyze 메서드)에서 전역 함수는 등록됨.
        // 하지만 중첩 함수의 경우 여기서 처리 필요할 수 있음.
        // 현재는 전역 함수 위주로 처리.
        
        const existing = this.currentScope.resolveLocal(node.name.name);
        if (!existing) {
            const params: ParamInfo[] = node.params.map(p => ({
                name: p.name.name,
                type: p.paramType || undefined,
            }));
            const inference = new TypeInference();
            const returnType = node.returnType || inference.inferReturnType(node, this.currentScope);

            this.currentScope.define({
                name: node.name.name,
                kind: "function",
                declarationRange: node.name.range,
                originalRange: node.name.range,
                params,
                returnType: returnType || undefined,
                documentation: node.documentation || undefined,
            });
        }

        this.visitFuncBody(node);
    }

    private visitIfStatement(node: AST.IfStatement): void {
        this.visitExpression(node.condition);
        this.visitStatement(node.consequent);

        for (const elseIf of node.elseIfClauses) {
            this.visitExpression(elseIf.condition);
            this.visitStatement(elseIf.consequent);
        }

        if (node.alternate) {
            this.visitStatement(node.alternate);
        }
    }

    private visitWhileStatement(node: AST.WhileStatement): void {
        this.visitExpression(node.condition);
        this.visitStatement(node.body);
    }

    private visitImportStatement(node: AST.ImportStatement): void {
        this.currentScope.define({
            name: node.source.name,
            kind: "import",
            declarationRange: node.source.range,
            originalRange: node.source.range,
        });
    }

    private visitExecuteStatement(node: AST.ExecuteStatement): void {
        
        const execScope = new Scope(node.body.range, this.currentScope);
        const previousScope = this.currentScope;
        this.currentScope = execScope;

        for (const stmt of node.body.body) {
            this.visitStatement(stmt);
        }

        this.currentScope = previousScope;
    }

    private visitBlockStatement(node: AST.BlockStatement): void {
        
        const blockScope = new Scope(node.range, this.currentScope);
        const previousScope = this.currentScope;
        this.currentScope = blockScope;

        for (const stmt of node.body) {
            this.visitStatement(stmt);
        }

        this.currentScope = previousScope;
    }

    private visitExpression(node: AST.Expression): void {
        switch (node.type) {
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
                    const symbol = this.currentScope.resolve(
                        node.target.name,
                        node.range.start
                    );
                    if (symbol && symbol.kind === "variable") {
                        const val = new TypeInference().evaluate(
                            node.value,
                            this.currentScope
                        );
                        this.currentScope.define({
                            ...symbol,
                            value: val || undefined,
                            declarationRange: node.target.range,
                            originalRange:
                                symbol.originalRange || symbol.declarationRange,
                        });
                    }
                }
                break;
            case "CallExpression":
                
                if (node.callee.type === "Identifier") {
                    this.handleTrackingFunction(
                        node.callee.name,
                        node.arguments
                    );
                }

                for (const arg of node.arguments) {
                    this.visitExpression(arg);
                }
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

    private handleTrackingFunction(
        funcName: string,
        args: AST.Expression[]
    ): void {
        const getArgValue = (arg: AST.Expression): string | null => {
            if (arg.type === "StringLiteral") return arg.value;
            return null;
        };

        if (funcName === "set_score" || funcName === "get_score") {
            const target = getArgValue(args[0]);
            const objective = getArgValue(args[1]);
            
            if (objective) {
                // 목적어 등록 (아직 등록되지 않은 경우에만)
                if (!this.globalScope.resolveLocal(objective)) {
                    this.globalScope.define({
                        name: objective,
                        kind: "score",
                        declarationRange: args[1].range,
                    });
                }
            }

            if (target && objective) {
                // 타겟 등록 (스코어 정보 포함)
                this.globalScope.define({
                    name: target,
                    kind: "score",
                    scope: objective,
                    declarationRange: args[0].range,
                });
            }
        } else if (funcName === "set_data" || funcName === "get_data") {
            const type = getArgValue(args[0]);
            const target = getArgValue(args[1]);
            if (type && target) {
                if (type === "storage") {
                    this.globalScope.define({
                        name: target,
                        kind: "storage",
                        declarationRange: args[1].range,
                    });
                }
            }
        }
    }
}
