#!/usr/bin/env node

const { runToolCli } = require('../../src');

const TOOL_CODE = 'example_greeting';
const OUTPUT_TYPE = 'example_greeting_summary.v1';

async function executeGreeting(args = []) {
  const [rawName = 'SkyCommand'] = Array.isArray(args) ? args : [];
  const name = String(rawName || '').trim();

  if (!name) {
    const error = new Error('Name cannot be blank.');
    error.code = 'NAME_REQUIRED';
    throw error;
  }

  return {
    name,
    greeting: `Hello, ${name}!`,
    generatedAt: new Date().toISOString(),
  };
}

function createGreetingToolResult(result) {
  return {
    schemaVersion: '1.0',
    success: true,
    message: `Greeting created for ${result.name}.`,
    outputType: OUTPUT_TYPE,
    output: result,
    warnings: [],
    error: null,
    metadata: {},
  };
}

function createGreetingFailureToolResult(error) {
  return {
    schemaVersion: '1.0',
    success: false,
    message: error?.message || 'Greeting creation failed.',
    outputType: OUTPUT_TYPE,
    output: {},
    warnings: [],
    error: {
      code: error?.code || 'EXAMPLE_GREETING_FAILED',
      message: error?.message || 'Greeting creation failed.',
    },
    metadata: {},
  };
}

function printGreeting(result) {
  console.log(result.greeting);
  console.log(`Generated at: ${result.generatedAt}`);
}

runToolCli({
  toolCode: TOOL_CODE,
  outputType: OUTPUT_TYPE,
  execute: executeGreeting,
  createToolResult: createGreetingToolResult,
  createFailureToolResult: createGreetingFailureToolResult,
  renderConsole: printGreeting,
});
