(function () {
  function decode(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function encode(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function prfInputs(input) {
    const output = { ...input };
    for (const field of ["first", "second"]) if (input?.[field]) output[field] = decode(input[field]);
    return output;
  }

  function publicKeyOptions(raw) {
    const source = raw?.publicKey || raw || {};
    const options = { ...source, challenge: decode(source.challenge) };
    if (source.user?.id) options.user = { ...source.user, id: decode(source.user.id) };
    for (const field of ["allowCredentials", "excludeCredentials"]) {
      if (Array.isArray(source[field])) options[field] = source[field].map((credential) => ({ ...credential, id: decode(credential.id) }));
    }
    if (source.extensions?.prf) {
      const prf = { ...source.extensions.prf };
      if (prf.eval) prf.eval = prfInputs(prf.eval);
      if (prf.evalByCredential) prf.evalByCredential = Object.fromEntries(Object.entries(prf.evalByCredential).map(([id, input]) => [id, prfInputs(input)]));
      options.extensions = { ...source.extensions, prf };
    }
    return options;
  }

  function serialiseCredential(credential) {
    const response = credential.response;
    const extensions = credential.getClientExtensionResults?.() || {};
    const output = {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      response: { clientDataJSON: encode(response.clientDataJSON) },
      // PRF output is a local encryption secret, never sent to the server.
      clientExtensionResults: extensions.prf ? { prf: { enabled: Boolean(extensions.prf.enabled || extensions.prf.results?.first) } } : {},
    };
    if (response.attestationObject) {
      output.response.attestationObject = encode(response.attestationObject);
      output.response.transports = response.getTransports?.() || [];
    }
    if (response.authenticatorData) output.response.authenticatorData = encode(response.authenticatorData);
    if (response.signature) output.response.signature = encode(response.signature);
    if (response.userHandle != null) output.response.userHandle = encode(response.userHandle);
    return output;
  }

  window.ALevelPasskeys = { publicKeyOptions, serialiseCredential };
})();
