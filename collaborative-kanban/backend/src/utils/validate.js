const { badRequest } = require('./errors');

// Parses `data` with a zod schema; throws a 400 with field-level details.
function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest('Validation failed', details);
  }
  return r.data;
}
module.exports = { parse };
