# Licensing and third-party notices

Batchloom's original application code and documentation are offered under the root [MIT license](LICENSE). Original AI-generated stationery imagery in `public/images/` is included for reuse with the application under the same permission to the extent the contributors can grant rights; this does not assert exclusive copyright in AI output. Generation prompts and provenance are recorded in `docs/image-prompts.md` and `docs/visual-direction.md`. The fictional notebooks are not photographs of real products or customers.

Third-party code and assets retain their upstream terms rather than being relicensed by the root license:

| Included component | Notice retained in this repository |
| --- | --- |
| WebLLM runtime in `public/local-ai/worker.js` | Apache-2.0 text in `public/local-ai/WEBLLM-LICENSE.txt` |
| loglevel dependency bundled with that worker | MIT notice in `public/local-ai/LOGLEVEL-LICENSE.txt` |
| Sites Vite integration | MIT notice in `scripts/vite/sites-vite-plugin.LICENSE` |
| Vendored shadcn Tailwind styles | `vendor/shadcn-tailwind-4.13.0.LICENSE.md` |

The model weights and compiled model WASM are downloaded from the pinned official upstream locations in `lib/local-model.ts`; they are not vendored as application source. Qwen3 and the MLC/WebLLM components identify Apache-2.0 licensing. Preserve their upstream notices when redistributing those artifacts. The exact model choice/revisions and official references are documented in `docs/AI.md`.

Other dependencies installed from the package lock retain their package licenses and notices. A public built bundle must preserve applicable generated license comments. This file is an attribution index, not a claim to replace the licenses of every transitive dependency.

PayPal names and trademarks identify the external service integration and are not licensed by this project's MIT license. This prototype is not endorsed by PayPal, Qwen, MLC, or the other dependency authors.
