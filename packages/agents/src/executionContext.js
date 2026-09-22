const { validateJsonSchema } = require('../../tools/src/jsonSchemaValidator');
const schema = require('../contracts/execution_context.v1.schema.json');

function buildExecutionContext(input = {}) {
  const context = {
    contract: 'execution_context.v1',
    ...input,
  };

  validateJsonSchema(context, schema, { schemaName: 'execution context' });
  return Object.freeze(context);
}

module.exports = {
  buildExecutionContext,
  executionContextSchema: schema,
};
