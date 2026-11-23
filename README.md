# Folio
A browser-based reader for books in another language. Import a book, look up unfamiliar words while reading, and practise the words you saved. No account or subscription is needed. The interface is in Russian.

[Introduction](https://folio-openreader.github.io/) · [Open the reader](https://folio-openreader.github.io/app.html#library) · [Sources and licences](dist/credits.html)

## Run locally
From this folder, with Python 3 installed:
```sh
python3 -m http.server 8000 --directory dist
```
Open http://localhost:8000/ for the landing page, or http://localhost:8000/app.html#library for the reader. Use HTTP on localhost or HTTPS, not `file://`. No npm install or API key is needed. The vanilla HTML/CSS/JavaScript under `dist/` **is the editable application source**. There is no bundler or network build step.

## What is included
- Text and paired EPUB/TXT reading; local PDF text/OCR; page-preserving comic PDF, image sequences and CBZ. Encrypted or unsupported inputs are rejected.
- 32 complete English-language starter editions (including the 1914 Constance Garnett translation of *Crime and Punishment*) and five attributed science papers. English news digests are fetched from Wikipedia when requested; a stale fallback is labelled.
- On-device dictionaries and optional English→Russian and English→Hindi paragraph translation. English→Spanish is word lookup, not a local paragraph model. Device voices vary by browser and installed language.
- Optional English read-aloud: in **Профиль → Звук и отклик** or the reader’s voice settings, download the 42.0 MB Folio pack, select Bella, Jasper, Luna or Bruno, then preview. It covers book reading and individual words. Inference runs in a local worker; it sends no text, audio or analytics. Deletion restores the device voice. Other languages continue to use locally available device voices. See [voice pack notices](dist/voices/NOTICE.txt).
- Files, words and reading progress stay in the current browser. Downloading static assets, refreshing news, and an explicitly configured external AI provider are different network operations. No shared service credentials ship with Folio. Text is sent to a provider only for a provider operation the user chooses; its own terms/CORS limits apply.
- **Manual encrypted word transfer:** in **Профиль → Перенос слов**, generate a recovery code, save it separately, prepare the file and click **Скачать файл**. On the second device, enter the same code, choose the file, inspect the additions, updates and deletions, then confirm. Export alone does not change the active dictionary or require an account. Import the latest shared file before replacing it. A lost code cannot unlock that file, but your local words remain accessible. On export-only devices Folio retains at most four local transfer journals (512 Ki UTF-16 code units in total), never silently pruning older revisions or deletion markers.
- Only saved words and recall status/schedule travel. Books, passage history, local examples, preferences, AI keys, local reading positions and bookmarks do not. File transfer is not background sync; Folio provides no storage service. The optional GitHub adapter is a **mock-tested prototype**, disabled in the reader. No token or live repository is required or used.
- After a confirmed vocabulary merge, use one writable Folio tab per device; another open tab is read-only for words and displays a notice. Close the other tab and reload before editing. The original local word store is retained separately. Changes made in an older version can be reviewed explicitly; they are not silently adopted.
- Changing browser, device or origin does not transfer data on its own. Export a backup first, and keep original comic files separately: comic page images are **not** in the JSON backup. A stored model is not a guarantee of offline startup or permanent browser storage.

## Verify
Use Node.js 22.12 or later. No dependency installation is needed.
```sh
npm test
```
Tests cover the app's original modules and JSON data, static Pages routes, manifest integrity and file checksums. To intentionally change static files, refresh hashes using `node tools/update-integrity.mjs`, inspect the exact diff and rerun tests before deploying. Do not add personal imports, backups, tokens or browser data to the repository.

## GitHub Pages
The intended destination is the **dedicated organization site** `folio-openreader/folio-openreader.github.io`. Put these files at the repository root (including `.github/workflows/pages.yml`), not inside another directory. Select **Settings → Pages → Source → GitHub Actions**. On the reviewed main commit run **Actions → Publish reviewed Folio release → Run workflow**. The manual workflow tests the source and deploys only `dist/`; it does not publish the repository root. Never point it at a personal checkout containing user data. The `index.html` at the published root is the introduction, while `app.html` is the reader. No custom domain, secret or paid hosting configuration is needed.

## Licence
[MIT](LICENSE) applies to original Folio software, copyright 2026 Olzhas Assemgazy. It does **not** relicense incorporated dependencies, fonts, book editions, research, news, dictionaries, or translation models. Preserve their individual credits and licences; see [source notices](dist/credits.html). The GPL Hindi dictionary includes its corresponding editable source beside its data. [OCR runtime notices](dist/vendor/ocr-v1/THIRD-PARTY/README.txt) and PDF component licences accompany their files.
