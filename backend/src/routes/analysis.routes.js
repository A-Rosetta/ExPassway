import { Router } from "express";
import { buildAnalysis } from "../services/analysis.service.js";

const router = Router();

router.post("/", (req, res) => {
  const body = req.body || {};
  const analysis = buildAnalysis({
    wrongLog: body.wrongLog,
    lastResult: body.lastResult,
    language: body.language,
  });

  res.json({
    ok: true,
    data: analysis,
  });
});

export default router;
