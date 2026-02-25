// @ts-nocheck
const serverless = require("serverless-http");
const { createApiApp } = require("../../src/api-app");

const app = createApiApp();
const handler = serverless(app, {
  request: (req, _event, _context) => req
});

export default async function apiCatchAll(req, res) {
  return handler(req, res);
}

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true
  }
};
