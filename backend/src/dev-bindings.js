function splitSqlList(value) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';

  for (const char of String(value || '')) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);

    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function getColumnName(value) {
  return String(value || '').trim().replace(/^["'`]|["'`]$/g, '').split('.').pop();
}

function createEmptySchema(table, columns = []) {
  return columns.map((name, index) => ({
    cid: index,
    name,
    type: 'TEXT',
    notnull: 0,
    dflt_value: null,
    pk: index === 0 ? 1 : 0,
  }));
}

function parseCreateTable(sql) {
  const text = normalizeSql(sql);
  const match = text.match(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)\s*\((.*)\)$/i);
  if (!match) return null;

  const [, table, rawColumns] = match;
  const definitions = splitSqlList(rawColumns);
  const columns = [];
  const primaryKeys = new Set();

  for (const definition of definitions) {
    const firstToken = getColumnName(definition.split(/\s+/)[0]);
    if (!firstToken || /^(primary|foreign|unique|constraint|check)$/i.test(firstToken)) {
      const tablePk = definition.match(/PRIMARY KEY\s*\(([^)]+)\)/i);
      if (tablePk) {
        for (const key of splitSqlList(tablePk[1])) primaryKeys.add(getColumnName(key));
      }
      continue;
    }

    columns.push(firstToken);
    if (/\bPRIMARY KEY\b/i.test(definition)) primaryKeys.add(firstToken);
  }

  return {
    table,
    schema: columns.map((name, index) => ({
      cid: index,
      name,
      type: 'TEXT',
      notnull: 0,
      dflt_value: null,
      pk: primaryKeys.has(name) ? index + 1 : 0,
    })),
  };
}

function extractTableName(sql) {
  const text = normalizeSql(sql);
  return (
    text.match(/PRAGMA table_info\((?:"|')?([a-z0-9_]+)(?:"|')?\)/i)?.[1] ||
    text.match(/\bFROM\s+([a-z0-9_]+)/i)?.[1] ||
    text.match(/\bINSERT INTO\s+([a-z0-9_]+)/i)?.[1] ||
    text.match(/\bUPDATE\s+([a-z0-9_]+)/i)?.[1] ||
    text.match(/\bDELETE FROM\s+([a-z0-9_]+)/i)?.[1] ||
    parseCreateTable(text)?.table ||
    null
  );
}

function extractInsertColumns(sql) {
  const match = normalizeSql(sql).match(/INSERT INTO\s+[a-z0-9_]+\s*\(([^)]+)\)\s*VALUES/i);
  return match ? splitSqlList(match[1]).map(getColumnName) : [];
}

function extractConflictColumns(sql, schema = []) {
  const match = normalizeSql(sql).match(/ON CONFLICT\s*\(([^)]+)\)/i);
  if (match) return splitSqlList(match[1]).map(getColumnName);

  const primaryKeys = schema.filter((column) => Number(column.pk || 0) > 0).map((column) => column.name);
  return primaryKeys.length ? primaryKeys : [schema[0]?.name].filter(Boolean);
}

function rowMatchesWhere(row, whereClause, bindings) {
  if (!whereClause) return true;

  let bindingIndex = 0;
  const conditions = whereClause.split(/\s+AND\s+/i).map((condition) => condition.trim()).filter(Boolean);

  for (const condition of conditions) {
    const equality = condition.match(/(?:[a-z0-9_]+\.)?([a-z0-9_]+)\s*=\s*\?/i);
    if (equality) {
      const expected = bindings[bindingIndex];
      bindingIndex += 1;
      if (String(row[equality[1]] ?? '') !== String(expected ?? '')) return false;
      continue;
    }

    const greaterThan = condition.match(/(?:[a-z0-9_]+\.)?([a-z0-9_]+)\s*>\s*\?/i);
    if (greaterThan) {
      const expected = bindings[bindingIndex];
      bindingIndex += 1;
      if (String(row[greaterThan[1]] ?? '') <= String(expected ?? '')) return false;
      continue;
    }

    const isNull = condition.match(/(?:[a-z0-9_]+\.)?([a-z0-9_]+)\s+IS\s+NULL/i);
    if (isNull) {
      if (row[isNull[1]] !== null && row[isNull[1]] !== undefined) return false;
      continue;
    }

    const isNotNull = condition.match(/(?:[a-z0-9_]+\.)?([a-z0-9_]+)\s+IS\s+NOT\s+NULL/i);
    if (isNotNull) {
      if (row[isNotNull[1]] === null || row[isNotNull[1]] === undefined) return false;
    }
  }

  return true;
}

export function createMemoryD1Database() {
  const rows = new Map();
  const schemas = new Map();

  const getRows = (table) => {
    if (!rows.has(table)) rows.set(table, []);
    return rows.get(table);
  };

  const getSchema = (table) => {
    if (!schemas.has(table)) schemas.set(table, createEmptySchema(table, ['id']));
    return schemas.get(table);
  };

  const db = {
    prepare(sql) {
      let bindings = [];
      const text = normalizeSql(sql);

      const statement = {
        bind(...values) {
          bindings = values;
          return statement;
        },
        async all() {
          const pragmaTable = text.match(/^PRAGMA table_info\((?:"|')?([a-z0-9_]+)(?:"|')?\)/i)?.[1];
          if (pragmaTable) return { results: getSchema(pragmaTable).map((row) => ({ ...row })) };

          if (/FROM user_roles ur JOIN roles r/i.test(text)) {
            const userId = bindings[0];
            const userRoleRows = getRows('user_roles').filter((row) => String(row.user_id) === String(userId));
            const roleRows = getRows('roles');
            return {
              results: userRoleRows
                .map((row) => roleRows.find((role) => String(role.id) === String(row.role_id)))
                .filter(Boolean)
                .sort((a, b) => String(a.slug || '').localeCompare(String(b.slug || ''))),
            };
          }

          if (/FROM users u LEFT JOIN user_roles ur/i.test(text)) {
            const roleRows = getRows('roles');
            const userRoleRows = getRows('user_roles');
            return {
              results: getRows('users').map((user) => ({
                ...user,
                roles_json: JSON.stringify(
                  userRoleRows
                    .filter((link) => String(link.user_id) === String(user.id))
                    .map((link) => roleRows.find((role) => String(role.id) === String(link.role_id)))
                    .filter(Boolean)
                    .map((role) => ({
                      id: role.id,
                      slug: role.slug,
                      name: role.name,
                      description: role.description,
                    }))
                ),
              })),
            };
          }

          if (!/^SELECT/i.test(text)) return { results: [] };

          const table = extractTableName(text);
          if (!table) return { results: [] };

          const whereClause = text.match(/\bWHERE\b\s+(.+?)(?:\s+ORDER BY\b|\s+LIMIT\b|$)/i)?.[1] || '';
          let resultRows = getRows(table)
            .filter((row) => rowMatchesWhere(row, whereClause, bindings))
            .map((row) => ({ ...row }));

          const order = text.match(/\bORDER BY\s+(?:[a-z0-9_]+\.)?([a-z0-9_]+)(?:\s+(ASC|DESC))?/i);
          if (order) {
            const [, column, direction = 'ASC'] = order;
            resultRows = resultRows.sort((a, b) => (
              direction.toUpperCase() === 'DESC'
                ? String(b[column] ?? '').localeCompare(String(a[column] ?? ''))
                : String(a[column] ?? '').localeCompare(String(b[column] ?? ''))
            ));
          }

          const limitLiteral = text.match(/\bLIMIT\s+(\d+)/i)?.[1];
          const limit = limitLiteral ? Number(limitLiteral) : null;
          if (Number.isFinite(limit)) resultRows = resultRows.slice(0, limit);

          return { results: resultRows };
        },
        async first() {
          const result = await statement.all();
          return result.results[0] || null;
        },
        async run() {
          const created = parseCreateTable(text);
          if (created) {
            schemas.set(created.table, created.schema);
            getRows(created.table);
            return { success: true };
          }

          if (/^(CREATE INDEX|PRAGMA)/i.test(text)) return { success: true };

          if (/^INSERT/i.test(text)) {
            const table = extractTableName(text);
            const schema = getSchema(table);
            const columns = extractInsertColumns(text);
            const record = {};
            columns.forEach((column, index) => {
              record[column] = bindings[index] ?? null;
            });

            const conflictColumns = extractConflictColumns(text, schema);
            const targetRows = getRows(table);
            const index = targetRows.findIndex((row) => (
              conflictColumns.length > 0 &&
              conflictColumns.every((column) => String(row[column] ?? '') === String(record[column] ?? ''))
            ));

            if (index >= 0) {
              targetRows[index] = { ...targetRows[index], ...record };
            } else {
              targetRows.push({ ...record });
            }

            return { success: true };
          }

          if (/^UPDATE/i.test(text)) {
            const table = extractTableName(text);
            const setClause = text.match(/\bSET\b\s+(.+?)\s+\bWHERE\b/i)?.[1] || '';
            const whereClause = text.match(/\bWHERE\b\s+(.+)$/i)?.[1] || '';
            const assignments = splitSqlList(setClause);
            const whereBindings = bindings.slice(assignments.length);

            for (const row of getRows(table).filter((item) => rowMatchesWhere(item, whereClause, whereBindings))) {
              assignments.forEach((assignment, index) => {
                const column = getColumnName(assignment.split('=')[0]);
                const value = bindings[index];
                if (/COALESCE\s*\(/i.test(assignment) && (value === null || value === undefined)) return;
                row[column] = value ?? null;
              });
            }

            return { success: true };
          }

          if (/^DELETE/i.test(text)) {
            const table = extractTableName(text);
            const whereClause = text.match(/\bWHERE\b\s+(.+)$/i)?.[1] || '';
            const tableRows = getRows(table);
            for (let index = tableRows.length - 1; index >= 0; index -= 1) {
              if (rowMatchesWhere(tableRows[index], whereClause, bindings)) tableRows.splice(index, 1);
            }
            return { success: true };
          }

          return { success: true };
        },
      };

      return statement;
    },
    async exec(sql) {
      for (const statement of String(sql || '').split(';').map((item) => item.trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
      return { success: true };
    },
    dump() {
      return Object.fromEntries([...rows.entries()].map(([table, tableRows]) => [table, tableRows.map((row) => ({ ...row }))]));
    },
  };

  return db;
}

export function createMemoryR2Bucket() {
  const objects = new Map();

  return {
    async put(key, value, options = {}) {
      const bytes = value instanceof ArrayBuffer
        ? Buffer.from(value)
        : Buffer.isBuffer(value)
          ? value
          : Buffer.from(String(value ?? ''));
      const uploaded = new Date();
      const etag = `"${key}:${bytes.length}:${uploaded.getTime()}"`;
      objects.set(key, {
        key,
        body: bytes,
        size: bytes.length,
        uploaded,
        etag,
        httpEtag: etag,
        httpMetadata: options.httpMetadata || null,
        customMetadata: options.customMetadata || null,
      });
      return objects.get(key);
    },
    async get(key) {
      const object = objects.get(key);
      return object ? { ...object } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(options = {}) {
      const prefix = String(options.prefix || '');
      const limit = Number.isFinite(options.limit) ? Number(options.limit) : 1000;
      return {
        objects: [...objects.values()]
          .filter((object) => !prefix || object.key.startsWith(prefix))
          .slice(0, limit)
          .map(({ body: _body, ...descriptor }) => descriptor),
        truncated: false,
        cursor: null,
        delimitedPrefixes: [],
      };
    },
  };
}

export function createMemoryQueue() {
  const messages = [];
  return {
    messages,
    async send(message) {
      messages.push(message);
      return { messageId: `msg_${messages.length}` };
    },
    async sendBatch(batch) {
      for (const item of batch || []) messages.push(item);
      return { messageId: `batch_${messages.length}` };
    },
  };
}
