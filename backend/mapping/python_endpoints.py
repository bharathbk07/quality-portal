"""Parse source as data with Python AST. Never import or execute repository code."""
import ast
import json
import sys

payload = json.load(sys.stdin)
limit = payload['limit']
env = payload.get('env', {})
results = []
routes = []
wrapper_defaults = {}
wrapper_operations = {}
for source in payload["files"]:
    if not source["path"].endswith(".py"):
        continue
    try:
        parsed = ast.parse(source["content"])
    except (SyntaxError, ValueError, RecursionError):
        continue
    aliases = {}
    for imp in ast.walk(parsed):
        if isinstance(imp, ast.ImportFrom) and imp.module in ('requests', 'httpx'):
            for item in imp.names:
                if item.name in ('get', 'post', 'put', 'patch', 'delete', 'head', 'options'):
                    aliases[item.asname or item.name] = item.name.upper()
    for c in ast.walk(parsed):
        if isinstance(c, ast.ClassDef):
            fields = {}
            operations = {}
            for member in c.body:
                if isinstance(member, ast.FunctionDef) and member.name == '__init__':
                    for assign in ast.walk(member):
                        if isinstance(assign, ast.Assign) and isinstance(assign.value, ast.Name):
                            for t in assign.targets:
                                if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == 'self':
                                    fields[t.attr] = assign.value.id
            for call in ast.walk(c):
                if isinstance(call, ast.Call):
                    operation = aliases.get(ast.unparse(call.func))
                    url_node = next((kw.value for kw in call.keywords if kw.arg == 'url'), call.args[0] if call.args else None)
                    if operation and isinstance(url_node, ast.Attribute) and url_node.attr == 'url' and isinstance(url_node.value, ast.Attribute):
                        target = url_node.value
                        if isinstance(target.value, ast.Name) and target.value.id == 'self' and target.attr in fields:
                            operations.setdefault(fields[target.attr], set()).add(operation)
            wrapper_operations[c.name] = {k: next(iter(v)) for k, v in operations.items() if len(v) == 1}

        if isinstance(c, ast.ClassDef) and c.name == "ApiRequest":
            for member in c.body:
                if isinstance(member, ast.AnnAssign) and isinstance(member.target, ast.Name) and member.target.id == "method" and isinstance(member.value, ast.Constant):
                    wrapper_defaults[c.name] = member.value.value
                if isinstance(member, ast.FunctionDef) and member.name == "__init__":
                    for arg, default in zip(member.args.args[-len(member.args.defaults):], member.args.defaults):
                        if arg.arg == "method" and isinstance(default, ast.Constant):
                            wrapper_defaults[c.name] = default.value


def key(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute) and node.value.attr == 'config' and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
        return 'config:' + node.slice.value
    return None

def evaluate(node, values):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    k = key(node)
    if k:
        return values.get(k)
    if isinstance(node, ast.JoinedStr):
        parts = []
        for v in node.values:
            if isinstance(v, ast.FormattedValue):
                value = evaluate(v.value, values)
                parts.append(value if value is not None else '{' + (v.value.id if isinstance(v.value, ast.Name) else 'parameter') + '}')
            else:
                parts.append(evaluate(v, values) or '')
        return ''.join(parts)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        a, b = evaluate(node.left, values), evaluate(node.right, values)
        return a + b if a is not None and b is not None else None
    if isinstance(node, ast.Call):
        name = ast.unparse(node.func)
        if name in ('os.getenv', 'os.environ.get') and node.args:
            return env.get(evaluate(node.args[0], values))
        if isinstance(node.func, ast.Attribute) and node.func.attr == 'format':
            template = evaluate(node.func.value, values)
            args = [evaluate(a, values) for a in node.args]
            if template is not None and all(a is not None for a in args):
                try:
                    return template.format(*args)
                except (ValueError, IndexError, KeyError):
                    return None
    return None

def assignments(nodes, inherited):
    values = dict(inherited)
    ambiguous = set()
    for _ in range(3):
        for n in nodes:
            if isinstance(n, ast.Assign):
                v = evaluate(n.value, values)
                for target in n.targets:
                    k = key(target)
                    if k and v is not None:
                        if k in values and values[k] != v:
                            ambiguous.add(k)
                        if k not in ambiguous:
                            values[k] = v
        for k in ambiguous:
            values.pop(k, None)
    return values

for file in payload['files']:
    if not file['path'].endswith('.py'):
        continue
    try:
        tree = ast.parse(file['content'])
    except (SyntaxError, ValueError, RecursionError):
        continue
    sessions = set()
    http_user_scopes = set()
    for declared in ast.walk(tree):
        if isinstance(declared, ast.Assign) and isinstance(declared.value, ast.Call) and ast.unparse(declared.value.func) in ('requests.Session', 'httpx.Client', 'httpx.AsyncClient'):
            sessions.update(ast.unparse(t) for t in declared.targets)
        if isinstance(declared, ast.ClassDef) and any(ast.unparse(b) in ('HttpUser', 'FastHttpUser', 'locust.HttpUser', 'locust.FastHttpUser') for b in declared.bases):
            http_user_scopes.update(id(member) for member in declared.body if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)))
    global_nodes = [n for n in ast.walk(tree) if isinstance(n, ast.Assign) and key(n.targets[0]) and key(n.targets[0]).startswith('config:')]
    shared = assignments(global_nodes, {})
    scopes = [tree] + [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    for scope in scopes:
        # Exclude nested function bodies from each local variable scope.
        def walk(n):
            yield n
            for child in ast.iter_child_nodes(n):
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                yield from walk(child)
        nodes = list(walk(scope))
        values = assignments(nodes, shared)
        if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in scope.decorator_list:
                if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute) and decorator.func.attr in ('route', 'get', 'post', 'put', 'patch', 'delete') and decorator.args:
                    path = evaluate(decorator.args[0], values)
                    methods = [decorator.func.attr.upper()] if decorator.func.attr != 'route' else ['GET']
                    for kw in decorator.keywords:
                        if kw.arg == 'methods' and isinstance(kw.value, (ast.List, ast.Tuple)):
                            methods = [evaluate(x, values) for x in kw.value.elts]
                    if path:
                        for method in methods:
                            if method and len(routes) < limit:
                                routes.append({'method': method, 'url': path, 'path': file['path'], 'line': decorator.lineno})
        implied_methods = {}
        for outer in nodes:
            if isinstance(outer, ast.Call):
                operations = wrapper_operations.get(ast.unparse(outer.func), {})
                for kw in outer.keywords:
                    if kw.arg in operations and isinstance(kw.value, ast.Call):
                        implied_methods[id(kw.value)] = operations[kw.arg]
        for n in nodes:
            if not isinstance(n, ast.Call) or len(results) >= limit:
                continue
            name = ast.unparse(n.func)
            method = implied_methods.get(id(n), wrapper_defaults.get(name))
            if name.startswith(('requests.', 'httpx.')) and name.split('.')[-1] in ('get', 'post', 'put', 'patch', 'delete', 'head', 'options'):
                method = name.split('.')[-1].upper()
            elif isinstance(n.func, ast.Attribute) and n.func.attr in ('get', 'post', 'put', 'patch', 'delete', 'head', 'options') and (ast.unparse(n.func.value) in sessions or (ast.unparse(n.func.value) == 'self.client' and id(scope) in http_user_scopes)):
                method = n.func.attr.upper()
            elif name not in ('ApiRequest', 'requests.request', 'httpx.request'):
                continue
            url_node = next((kw.value for kw in n.keywords if kw.arg == 'url'), n.args[0] if n.args else None)
            if name.endswith('.request'):
                method = evaluate(n.args[0], values) if n.args else None
                url_node = next((kw.value for kw in n.keywords if kw.arg == 'url'), n.args[1] if len(n.args) > 1 else None)
            for kw in n.keywords:
                if kw.arg == 'method':
                    method = evaluate(kw.value, values)
            url = evaluate(url_node, values) if url_node is not None else None
            if url and len(url) <= 2048:
                results.append({'method': method or 'HTTP', 'url': url, 'path': file['path'], 'line': n.lineno})
print(json.dumps({'calls': results, 'routes': routes}))
