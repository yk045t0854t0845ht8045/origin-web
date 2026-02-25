const serverless = require("serverless-http");
const { createApiApp } = require("../../src/api-app");

const app = createApiApp();
const handler = serverless(app, {
  request: (req, _event, _context) => req
});

module.exports = async (req, res) => handler(req, res);

module.exports.config = {
  api: {
    bodyParser: false,
    externalResolver: true
  }
};
