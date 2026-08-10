# Third-party notices

The browser chat crypto worker bundles `@privacyresearch/libsignal-protocol-typescript` 0.0.16 and its transitive `@privacyresearch/*` dependencies. Those packages are distributed under GPL-3.0-only. Their license text is included in the installed package and the project source distribution; see the package metadata in `node_modules` during development or the upstream package repository before redistributing a modified bundle.

The bundle is an adapter for the Signal protocol family. It is not an official Signal client, and the server-side chat code never receives the private keys managed by the browser worker.

The recovery backup path bundles `libsodium-wrappers-sumo` 0.8.4 and its `libsodium-sumo` runtime under ISC. It is used only for Argon2id password-based key derivation and digest operations; it does not replace the Signal session protocol.
