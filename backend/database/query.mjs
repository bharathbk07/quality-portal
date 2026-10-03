import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
/** Build parameterized statements from repository-owned SQL; never accept a request-supplied statement. */
export function executeStatement(connection, statement, values = []) {
  const query = sql.empty();
  let offset = 0;
  for (const match of statement.matchAll(/\$(\d+)/g)) {
    query.append(sql.raw(statement.slice(offset, match.index)));
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= values.length)
      throw new Error("Missing query binding");
    query.append(sql`${values[index]}`);
    offset = match.index + match[0].length;
  }
  query.append(sql.raw(statement.slice(offset)));
  return drizzle(connection).execute(query);
}
