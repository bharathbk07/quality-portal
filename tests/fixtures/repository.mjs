export const fixture = [
  {
    path: "compose.yaml",
    content:
      "services:\n  gateway:\n    image: traefik:v3\n    volumes:\n      - ./routes.yaml:/etc/routes.yaml\n  frontend:\n    build: ./apps/web\n    depends_on: [api]\n  api:\n    build: ./apps/api\n    environment:\n      DATABASE_URL: postgres://user:SECRET_VALUE@db:5432/example\n    depends_on: [db]\n  db:\n    image: postgres:17\n",
  },
  {
    path: "routes.yaml",
    content:
      "http:\n  services:\n    api:\n      loadBalancer:\n        servers:\n          - url: http://api:4000\n",
  },
  {
    path: "apps/web/package.json",
    content: JSON.stringify({
      name: "web",
      dependencies: { react: "1", shared: "workspace:*" },
    }),
  },
  {
    path: "apps/api/package.json",
    content: JSON.stringify({
      name: "api",
      dependencies: { fastify: "1", pg: "1" },
    }),
  },
  {
    path: "packages/shared/package.json",
    content: JSON.stringify({ name: "shared" }),
  },
  {
    path: "apps/api/index.ts",
    content:
      "import {shared} from '../../packages/shared/index.js';\nconsole.log('never execute me');",
  },
  { path: "packages/shared/index.ts", content: "export const shared = 1;" },
];
