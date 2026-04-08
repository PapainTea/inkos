function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildCommandResponse(result) {
  const data = tryParseJson(result.stdout) ?? { error: result.stderr || result.stdout };
  return {
    ok: result.code === 0 && !data.error,
    error: data.error || undefined,
    data,
    raw: result,
  };
}

module.exports = {
  buildCommandResponse,
};
