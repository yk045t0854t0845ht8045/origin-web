// @ts-nocheck
const { supabaseHealthCheck } = require("../../../src/supabase-dashboard");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Metodo nao permitido."
    });
    return;
  }

  const output = await supabaseHealthCheck();
  if (!output.ok) {
    res.status(502).json(output);
    return;
  }
  res.status(200).json(output);
}

