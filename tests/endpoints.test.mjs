import test from "node:test";
import assert from "node:assert/strict";
import {
  pythonEndpoints,
  safeEndpoint,
  endpointLabel,
} from "../backend/mapping/endpoints.mjs";
import { mappingConfig } from "../backend/mapping/config.mjs";
test("Python AST resolves environment-backed paths, method defaults, placeholders and local URLs without executing source", () => {
  const files = [
    {
      path: "frontend.py",
      content: `import os, requests
app.config['BALANCES_URI'] = 'http://{}/balances'.format(os.environ.get('BALANCES_ADDR'))
app.config['LOGIN_URI'] = 'http://{}/login'.format(os.environ.get('USERS_ADDR'))
def home():
    ApiRequest(url=f'{app.config["BALANCES_URI"]}/{account_id}')
def login():
    url = app.config['LOGIN_URI']
    requests.post(url=url)
# requests.delete('http://danger.example/delete')
@app.route('/payment', methods=['POST'])
def payment():
    pass
raise Exception('This must not execute')
`,
    },
    {
      path: "api_call.py",
      content: `class ApiRequest:
    def __init__(self, url, method='GET'):
        self.method = method
`,
    },
  ];
  const output = pythonEndpoints(
    files,
    { BALANCES_ADDR: "balance:8080", USERS_ADDR: "users:8080" },
    mappingConfig(),
  );
  assert.deepEqual(
    output.calls.map((c) => [c.method, c.url]),
    [
      ["GET", "http://balance:8080/balances/{account_id}"],
      ["POST", "http://users:8080/login"],
    ],
  );
  assert.equal(output.routes[0].method, "POST");
  assert.equal(output.routes[0].url, "/payment");
  assert.equal(
    endpointLabel({
      relation: "configured endpoint",
      endpoints: output.calls.map((c) => safeEndpoint(c.url, c.method)),
    }),
    "GET /balances/{account_id} · POST /login",
  );
  const clean = safeEndpoint(
    "https://user:password@api.example/orders?token=secret#private",
    "GET",
  );
  assert.deepEqual(clean, {
    address: "api.example",
    path: "/orders",
    method: "GET",
    protocol: "https",
  });
  assert.equal(
    endpointLabel({ relation: "configured endpoint" }),
    "Request path unresolved",
  );
});

test("request wrappers infer a method only from a declared transport call", () => {
  const files = [
    {
      path: "wrapper.py",
      content: `from requests import get
class ApiRequest:
    def __init__(self, url):
        self.url = url
class ApiCall:
    def __init__(self, api_request):
        self.api_request = api_request
    def make_call(self):
        return get(url=self.api_request.url)
`,
    },
    {
      path: "main.py",
      content: `def home():
    ApiCall(api_request=ApiRequest(url="http://balance:8080/balances/{account_id}"))
    ApiRequest(url="http://balance:8080/unconsumed")
`,
    },
  ];
  const calls = pythonEndpoints(files, {}, mappingConfig()).calls;
  assert.deepEqual(
    calls.map((c) => c.method),
    ["GET", "HTTP"],
  );
});

test("multiple literal JS calls retain their individual methods and paths", async () => {
  const { discoverFlowDetails } =
    await import("../backend/mapping/flow-diagrams.mjs");
  const g = {
    nodes: [
      { id: "web", label: "web", kind: "frontend" },
      { id: "api", label: "api", kind: "service" },
    ],
    edges: [],
  };
  discoverFlowDetails(
    g,
    [
      {
        path: "web.js",
        content: `fetch('http://api/users'); fetch('http://api/orders', {method:'POST'}); // fetch('http://api/fake')`,
      },
    ],
    [{ root: "", id: "web" }],
  );
  assert.equal(endpointLabel(g.edges[0]), "GET /users · POST /orders");
  assert.equal(g.edges.length, 1);
});

test("Python session and Locust client calls resolve methods while generic self.client remains unknown", () => {
  const parsed = pythonEndpoints(
    [
      {
        path: "load.py",
        content: `from locust import HttpUser
import requests
class User(HttpUser):
    def task(self):
        self.client.get('/accounts')
class Other:
    def task(self):
        self.client.delete('/unverified')
client = requests.Session()
client.post('http://api/orders')
`,
      },
    ],
    {},
    mappingConfig(),
  );
  assert.equal(parsed.calls.length, 2);
  assert.equal(parsed.calls[0].url, "http://api/orders");
  assert.equal(parsed.calls[1].url, "/accounts");
  assert.equal(parsed.calls[1].method, "GET");
});
