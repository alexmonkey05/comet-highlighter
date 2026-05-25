import * as AST from "../parser/ast";
import { Scope } from "./scope";

export class TypeInference {
    infer(node: AST.Expression, scope: Scope): string {
        switch (node.type) {
            case "IntLiteral":
                return "int";
            case "FloatLiteral":
                return "float";
            case "DoubleLiteral":
                return "double";
            case "StringLiteral":
                return "string";
            case "BoolLiteral":
                return "bool";
            case "ArrayLiteral":
                return "array";
            case "NbtLiteral":
                return "nbt";

            case "Identifier": {
                const symbol = scope.resolve(node.name);
                if (symbol) {
                    // 심볼의 returnType이 있다면 그것을 반환
                    if (symbol.returnType && symbol.returnType !== "any") {
                        return symbol.returnType;
                    }
                    
                    // 만약 함수라면 본문을 통해 다시 한번 추론 시도 (이미 ScopeAnalyzer에서 처리되었겠지만 안전 장치)
                    if (symbol.kind === "function") {
                        return symbol.returnType || "any";
                    }
                }
                return "any";
            }

            case "BinaryExpression": {
                const left = this.infer(node.left, scope);
                const right = this.infer(node.right, scope);

                const numericTypes = ["int", "float", "double"];
                if (numericTypes.includes(left) && numericTypes.includes(right)) {
                    if (left === "double" || right === "double") return "double";
                    if (left === "float" || right === "float") return "float";
                    return "int";
                }

                if (left === "string" || right === "string") return "string";
                if (left === "bool" && right === "bool") return "bool";

                return "any";
            }

            case "CallExpression": {
                if (node.callee.type === "Identifier") {
                    const symbol = scope.resolve(node.callee.name);
                    if (symbol && symbol.returnType) {
                        return symbol.returnType;
                    }
                    
                    // 만약 심볼은 있지만 반환 타입이 없다면 (사용자 정의 함수인 경우)
                    if (symbol && symbol.kind === "function") {
                        // 실제 함수 노드를 찾아서 추론 시도
                        // 주의: 이 방식은 HoverProvider에 있는 로직과 유사함
                        // TypeInference 자체는 AST 전체에 대한 지식이 없으므로
                        // 일단 any를 반환하되, ScopeAnalyzer 등에서 미리 채워주는 것이 좋음.
                        // 하지만 여기서는 기본 내장 함수 매칭을 먼저 함.
                    }

                    if (node.callee.name === "int") return "int";
                    if (node.callee.name === "float") return "float";
                    if (node.callee.name === "double") return "double";
                    if (node.callee.name === "string") return "string";
                    if (node.callee.name === "bool") return "bool";
                }
                return "any";
            }

            case "ParenExpression":
                return this.infer(node.expression, scope);

            case "UnaryExpression": {
                if (node.operator === "!") return "bool";
                if (node.operator === "-") return this.infer(node.argument, scope);
                return "any";
            }

            default:
                return "any";
        }
    }

    evaluate(node: AST.Expression, scope: Scope): string | null {
        switch (node.type) {
            case "IntLiteral":
            case "FloatLiteral":
            case "DoubleLiteral":
            case "StringLiteral":
            case "BoolLiteral":
                return node.raw;
            case "Identifier": {
                const symbol = scope.resolve(node.name, node.range.start);
                return symbol?.value || null;
            }
            case "ParenExpression":
                return this.evaluate(node.expression, scope);
            case "UnaryExpression": {
                if (node.operator === "-") {
                    const val = this.evaluate(node.argument, scope);
                    if (val !== null) return "-" + val;
                }
                return null;
            }
            default:
                return null;
        }
    }

    inferReturnType(node: AST.FuncDeclaration, scope: Scope): string {
        if (node.returnType) return node.returnType;

        const returnTypes = new Set<string>();
        
        const visit = (stmt: AST.Statement) => {
            if (stmt.type === "ReturnStatement") {
                if (stmt.argument) {
                    returnTypes.add(this.infer(stmt.argument, scope));
                } else {
                    returnTypes.add("void");
                }
            } else if (stmt.type === "BlockStatement") {
                stmt.body.forEach(visit);
            } else if (stmt.type === "IfStatement") {
                visit(stmt.consequent);
                stmt.elseIfClauses.forEach(c => visit(c.consequent));
                if (stmt.alternate) visit(stmt.alternate);
            } else if (stmt.type === "WhileStatement") {
                visit(stmt.body);
            }
        };

        node.body.body.forEach(visit);

        if (returnTypes.size === 0) return "void";
        if (returnTypes.size === 1) return Array.from(returnTypes)[0];
        
        const types = Array.from(returnTypes);
        if (types.includes("any")) return "any";
        return types.join("|");
    }
}
