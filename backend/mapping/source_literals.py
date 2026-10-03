"""Read Python string declarations using AST; never import repository code."""
import ast
import json
import sys

source = json.load(sys.stdin)
result = []
try:
    tree = ast.parse(source["content"])
    excluded = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.body and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant):
                excluded.add(id(node.body[0].value))
    def value(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left, right = value(node.left), value(node.right)
            return left + right if left is not None and right is not None else None
        if isinstance(node, ast.JoinedStr):
            return "".join(value(v) if isinstance(v, ast.Constant) else "{parameter}" for v in node.values)
        return None
    def visit(node):
        if id(node) in excluded:
            return
        literal = value(node)
        if literal is not None:
            offset = sum(len(line) for line in source["content"].splitlines(keepends=True)[:node.lineno-1]) + node.col_offset
            result.append({"text": literal, "offset": offset, "line": node.lineno})
            return
        for child in ast.iter_child_nodes(node):
            visit(child)
    visit(tree)
except (SyntaxError, ValueError, RecursionError):
    pass
print(json.dumps(result))
