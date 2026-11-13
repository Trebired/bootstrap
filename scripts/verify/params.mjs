import assert from "node:assert/strict";

function attachNoArgs() {
  return [1].map((socket) => socket).filter((id) => id);
}

async function attachAsync(app, io) {
  return [app, io].map((value) => value);
}

const arrowParams = (app, { strict } = {}) => [app, strict];
const singleArrow = app => (value) => [app, value];

class Holder {
  attach(server, log = (message) => message) {
    return [server, log];
  }
}

async function verifyParamParsing(parseParamTokensFromFn) {
  assert.deepEqual(parseParamTokensFromFn(attachNoArgs), [], "a function without parameters has none, whatever arrows its body holds");
  assert.deepEqual(parseParamTokensFromFn(attachAsync), ["app", "io"], "an async function's parameters are read from its own list");
  assert.deepEqual(parseParamTokensFromFn(arrowParams), ["app", "{ strict }"], "an arrow function's list is read with balanced brackets");
  assert.deepEqual(parseParamTokensFromFn(singleArrow), ["app"], "a single-parameter arrow is read");
  assert.deepEqual(parseParamTokensFromFn(new Holder().attach), ["server", "log"], "a method's list stops at its own closing bracket");
}

export { verifyParamParsing };
